const axios = require('axios');
const EventEmitter = require('events');

const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const MIN_WAIT = 1000;
const DATA_TIMEOUT = 30000;

/**
 * Process error to determine if it's either an axios timeout or response stream timeout
 * @private
 */
function isTimedout(error) {
  return error.code === 'ECONNABORTED' || error.isTimeout
}

/**
 * Statuses that can be retried
 * @private
 */
function retriableStatus(resp) {
  let status = resp.status;
  const valid_statuses = [429, 420, 504, 503, 502, 500];
  return valid_statuses.includes(status);
}

/**
 * Returns def if num is NaN
 * @private
 */
function defaultNaN(num, def) {
  if(isNaN(num)) {
    return def;
  } else {
    return num;
  }
}

/**
 * Returns a Promise that resolves on timeout
 * @private
 */
const sleep = (milliseconds) => { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

/**
 * Rate limits response based on last retry attempt.
 * @private
 * @param {object} resp Response object that preferably defines resp.status and resp.headers
 * @param {Date} last_retry Date of previous retry attempt
 * @returns {Promise<number>} Promise that resolves to the timeout value used in rate limit
 */
async function rateLimiting(resp, last_retry) {
  const headers = resp.headers;
  let now = Date.now()
  let remaining = defaultNaN(parseInt(headers['x-rate-limit-remaining']), 0);
  let ratelimit = defaultNaN(parseInt(headers['x-rate-limit-reset']), now + RATE_LIMIT_WINDOW);
  let backoff;
  ratelimit = new Date(ratelimit * 1000);

  if(resp.status >= 500) {
    let delta = Math.min(RATE_LIMIT_WINDOW, (now - last_retry)) / RATE_LIMIT_WINDOW;
    backoff = Math.floor((Math.log(delta + 1) + 0.3) * RATE_LIMIT_WINDOW);
  } else if(remaining === 0 || resp.status === 429 || resp.status === 420) {
    backoff = Math.min(ratelimit - now, RATE_LIMIT_WINDOW);
  } else {
    backoff = MIN_WAIT;
  }

  await sleep(backoff);
  return Promise.resolve(backoff);
}

/**
 * Connect to the Twitter API v2 sampled stream endpoint and emit events for processing<br/>
 * For additional information see [Twitter Sampled Stream]{@link https://developer.twitter.com/en/docs/twitter-api/tweets/sampled-stream/introduction}
 * @extends EventEmitter
 */
class StreamClient extends EventEmitter {
  /**
   * Initializes the client
   * @param {Object} config Configuration for client
   * @param {number} config.timeout Set request and response timeout
   * @param {string} config.token Set [OAUTH Bearer token]{@link https://developer.twitter.com/en/docs/authentication/oauth-2-0} from developer account
   */
  constructor({token, timeout = DATA_TIMEOUT}) {
    super();
    this.timeout = timeout;
    this.twitrClient = axios.create({
      baseURL: 'https://api.twitter.com/2',
      headers: { 'Authorization': `Bearer ${token}`},
      timeout: timeout
    });
  }

  /**
   * Connect to twitter stream and emit events.
   * @param {Object} config Configuration for connection
   * @param {number} config.params Set any filter parameters for stream, etc.
   * @param {string} config.max_reconnects Specify max number of reconnects. Default: -1 (infinity)
   * @returns {(Promise|Promise<Error>)} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
   * -- the Promise rejects if the number of reconnects exceeds the max or on irrecoverable error
   * @see retriableStatus
   */
  async connect({ params = {}, max_reconnects = -1 } = {}) {
    let reconnects = 0;
    let last_try = Date.now();
    while(max_reconnects === -1 || reconnects <= max_reconnects)
    {
      try
      {
        reconnects += 1;
        await this.buildConnection(params);
      }
      catch(request_error)
      {
        let resp = request_error.response;
        if(axios.isCancel(request_error)) {
          return Promise.resolve();
        } else if(isTimedout(request_error) || resp && retriableStatus(resp)) {
          this.emit('error', request_error);
          let timeout_wait = await rateLimiting(resp, last_try);
          this.emit('reconnect', timeout_wait);
        } else {
          let error = request_error; //new Error(request_error);
          this.emit('error', error);
          return Promise.reject(error);
        }
      }
      last_try = Date.now();
    }

    return Promise.reject(new Error(`Max reconnects exceeded (${reconnects})`));
  }

  /**
   * Disconnects an active request if any
   * @returns {boolean} Returns true if there is a request to disconnect
   */
  disconnect() {
    if( this.cancelToken !== undefined ) {
      this.cancelToken.cancel('Disconnecting stream');
      console.log('Disconnecting stream');
      this.cancelToken = undefined;
    }
  }

  /**
   * Emits data from twitter stream after retreiving chunk
   * @private
   * @param {string} chunk String of data from stream
   */
  processChunk(chunk) {
    this.chunkBuffer = this.chunkBuffer || '';
    this.chunkBuffer += chunk.toString('utf8');
    const EOF = '\r\n';
    let index;

    // Scan chunks for EOF terminator
    while( (index = this.chunkBuffer.indexOf(EOF)) > -1 ) {
      let chunk = this.chunkBuffer.slice(0, index);
      this.chunkBuffer = this.chunkBuffer.slice(index + EOF.length);
      if( chunk.length > 0 ) {
        try {
          let json = JSON.parse(chunk);
          if( json.data !== undefined ) {
            this.emit('tweet', json);
          } else if(json.errors) {
            this.emit('error-api', json)
          } else {
            this.emit('other', json);
          }
        } catch(json_error) {
          json_error.source = chunk;
          this.emit('error', json_error);
        }
      } else {
        this.emit('heartbeat');
      }
    }
  }

  /**
   * Clear the chunk buffer
   * @private
   */
  flush() {
    this.chunkBuffer = '';
  }

  /**
   * Connect to twitter stream and emit events. Errors unhandled.
   * @private
   * @returns {Promise} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
   * -- the Promise chain is unhandled so consider using [.connect]{@link StreamClient#connect}
   */
  buildConnection(params) {
    this.disconnect();
    this.flush();
    this.cancelToken = axios.CancelToken.source();

    let streamReq = this.twitrClient.get('tweets/sample/stream', {
      responseType: 'stream',
      cancelToken: this.cancelToken.token,
      params: params,
      decompress: true,
    });

    return streamReq.then((resp) => {
      return new Promise((resolve, reject) => {
        let error;
        let lastChunkUpdate = Date.now();
        const hose = resp.data;
        this.emit('connected');

        setInterval(() => {
          if(Date.now() - lastChunkUpdate > this.timeout) {
            let e = new Error(`Timed out after ${this.timeout / 1000} seconds of no data`);
            e.isTimeout = true;
            hose.emit('error', e);
          }
        }, this.timeout);

        hose.on('close', () => {
          if( !error ) {
            this.emit('close');
            resolve();
          }
        });
        hose.on('data', data => {
          let now = Date.now();
          if(now > lastChunkUpdate) {
            lastChunkUpdate = now;
          }
          this.processChunk(data);
        });
        hose.on('error', stream_error => {
          error = stream_error;
          if(!hose.destroyed) {
            hose.destroy(error);
          }
          reject(stream_error);
        });
      });
    });
  }
}

/* Events
reconnect
error
connected
error-api
tweet
other
heartbeat
close
*/

let stream_client = new StreamClient({
  token: 'AAAAAAAAAAAAAAAAAAAAAGcIGQEAAAAA6feg2gwtEuzWCWBoXT5Wy3IdEsE%3D0j7C1xxyslGEE6iKZRiW0BoU7iQT6cQwix3z98IJwVqHde6sjb'
});

stream_client.on('tweet', (tweet) => console.log(tweet));
stream_client.on('error-api', (errors) => console.log(errors));
stream_client.on('error', (error) => console.log(error));
stream_client.on('close', () => console.log("Client connection closed"));
stream_client.connect().catch(() => {
  console.log('Caught error in stream client');
});

// setTimeout(() => stream_client.disconnect(), 5000);
