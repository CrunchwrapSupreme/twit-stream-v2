const axios = require('axios');
const EventEmitter = require('events');
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const DATA_TIMEOUT = 30000;

/**
 * Triggered when stream and provides twitter error messages as JSON objects
 * @type {Object}
 * @event StreamClient#stream-error
 */

/**
 * Triggered on stream connection
 * @event StreamClient#connected
 */

/**
 * Triggered before stream reconnect and provides the wait time till reconnect
 * @type {number}
 * @event StreamClient#reconnect
 */

/**
 * Triggered when manually disconnecting client stream
 * @event StreamClient#disconnected
 */

/**
 * Triggered upon connected stream receiving a tweet
 * @type {Object}
 * @event StreamClient#tweet
 */

/**
 * Triggered upon connected stream receiving a heartbeat
 * @event StreamClient#heartbeat
 */

/**
 * Triggered upon stream close
 * @event StreamClient#close
 */

/**
 * Triggered upon connected stream receiving unexpected JSON
 * @type {Object}
 * @event StreamClient#other
 */

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
 * Calculate rate limit time in milliseconds
 * @private
 * @param {Object} resp Response object that preferably defines resp.status and resp.headers
 * @param {Date} last_retry Date of previous retry attempt
 * @returns {number} Backout time
 */
function rateLimiting(resp, last_retry) {
  const now = Date.now()
  const fallback_rate = now + RATE_LIMIT_WINDOW;
  let backoff, ratelimit, remaining;

  if(resp && resp.headers) {
    const headers = resp.headers;
    remaining = defaultNaN(parseInt(headers['x-rate-limit-remaining']), 0);
    ratelimit = defaultNaN(parseInt(headers['x-rate-limit-reset']), fallback_rate / 1000);
    ratelimit = new Date(ratelimit * 1000);
  } else {
    remaining = -1;
    ratelimit = fallback_rate;
  }

  if(remaining === 0 || resp && (resp.status === 429 || resp.status === 420)) {
    backoff = Math.min(ratelimit - now, RATE_LIMIT_WINDOW);
  } else {
    let delta = Math.min(RATE_LIMIT_WINDOW, (now - last_retry)) / RATE_LIMIT_WINDOW;
    backoff = Math.max(delta * RATE_LIMIT_WINDOW, 1000);
  }

  return backoff;
}

/**
 * Connect to the Twitter API v2 sampled stream endpoint and emit events for processing<br/>
 * For additional information see
 * [Twitter Sampled Stream]{@link https://developer.twitter.com/en/docs/twitter-api/tweets/sampled-stream/introduction}
 * @extends EventEmitter
 * @fires StreamClient#tweet
 * @fires StreamClient#connected
 * @fires StreamClient#reconnect
 * @fires StreamClient#disconnected
 * @fires StreamClient#close
 * @fires StreamClient#stream-error
 * @fires StreamClient#heartbeat
 * @fires StreamClient#other
 */
class StreamClient extends EventEmitter {
  /**
   * Initializes the client
   * @param {Object} config Configuration for client
   * @param {number} config.timeout Set request and response timeout
   * @param {string} config.token Set [OAUTH Bearer token]{@link https://developer.twitter.com/en/docs/authentication/oauth-2-0} from developer account
   */
  constructor({token, timeout = DATA_TIMEOUT, stream_timeout = DATA_TIMEOUT}) {
    super();
    this.timeout = timeout;
    this.twitrClient = axios.create({
      baseURL: 'https://api.twitter.com/2',
      headers: { 'Authorization': `Bearer ${token}`},
      timeout: timeout
    });
    this.stream_timeout = stream_timeout;
  }

  /**
   * Connect to twitter stream and emit events.
   * @param {Object} config Configuration for connection
   * @param {number} config.params Set any filter parameters for stream, etc.
   * @param {string} config.max_reconnects Specify max number of reconnects. Default: -1 (infinity)
   * @returns {(Promise<object>|Promise<Error>)} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
   * -- the Promise rejects if the number of reconnects exceeds the max or an irrecoverable error occurs
   * -- the Promise resolves with that last error returned. Error object defines .reconnects if reconnects are exceeded
   * @see retriableStatus
   */
  async connect({ params = {}, max_reconnects = -1 } = {}) {
    let reconnects = -1;
    let last_try = Date.now();
    let last_error;

    while(max_reconnects === -1 || reconnects <= max_reconnects)
    {
      let disconnected = false;
      try
      {
        reconnects += 1;
        disconnected = await this.buildConnection(params);

        if(disconnected) {
          Promise.resolve();
        }
      }
      catch(request_error)
      {
        last_error = request_error;
        let resp = request_error.response;
        if(axios.isCancel(request_error)) {
          return Promise.resolve();
        } else if(max_reconnects !== -1 && reconnects >= max_reconnects) {
          break;
        } else if(isTimedout(request_error) || resp && retriableStatus(resp)) {
          let timeout_wait = rateLimiting(resp, last_try);
          this.emit('reconnect', request_error, timeout_wait);
          await sleep(timeout_wait);
        } else {
          let error = new Error(`${request_error.message}`);
          return Promise.reject(error);
        }
      }

      last_try = Date.now();
    }

    let reject_error = new Error(`Max reconnects exceeded (${reconnects}):\n${last_error.message}`);
    reject_error.reconnects = reconnects;
    return Promise.reject(reject_error);
  }

  /**
   * Disconnects an active request if any
   * @returns {boolean} Returns true if there is a request to disconnect
   */
  disconnect() {
    if(this.cancelToken) {
      this.cancelToken.cancel('Disconnecting stream');
      this.cancelToken = null;
    }
    this.emit('disconnected');
  }

  /**
   * Emits data from twitter stream after retreiving chunk
   * @private
   * @param {string} chunk String of data from stream
   */
  processChunk(chunk) {
    const EOF = '\r\n';
    if(this.chunkBuffer && chunk) {
      this.chunkBuffer = Buffer.concat([this.chunkBuffer, chunk]);
    } else if(chunk) {
      this.chunkBuffer = chunk;
    }

    let index;
    while( (index = this.chunkBuffer.indexOf(EOF, 'utf8')) > -1 ) {
      let chunk = this.chunkBuffer.toString('utf8', 0, index);
      this.chunkBuffer = this.chunkBuffer.slice(index + EOF.length);
      if(chunk.length > 0) {
        try {
          let json = JSON.parse(chunk);
          if(json.data) {
            this.emit('tweet', json);
          } else if(json.errors) {
            this.emit('stream-error', json);
          } else {
            this.emit('other', json);
          }
        } catch(json_error) {
          json_error.source = chunk;
          this.emit('stream-error', json_error);
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
    if(this.chunkBuffer) {
      this.processChunk();
      this.chunkBuffer = null;
    }
  }

  /**
   * Build Promises for handling data stream in [.buildConnection]{@link StreamClient#buildConnection}
   * @private
   * @returns {Promise} Promise that initiates HTTP streaming
   */
  buildStreamPromise(resp) {
    return new Promise((resolve, reject) => {
      this.emit('connected');
      let error;
      let disconnected = false;
      const hose = resp.data;
      const hose_cleanup = () => {
        if(!hose.destroyed) {
          hose.destroy();
        }
      };

      let timer = setTimeout(() => {
        let e = new Error(`Timed out after ${this.stream_timeout / 1000} seconds of no data`);
        e.isTimeout = true;
        hose.emit('error', e);
      }, this.stream_timeout);

      this.once('disconnected', () => {
        disconnected = true;
        hose_cleanup();
      });

      hose.on('close', () => {
        clearTimeout(timer);
        this.removeListener('disconnected', hose_cleanup);
        this.flush();
        if(!error) {
          this.emit('close');
          resolve(disconnected);
        }
      });

      hose.on('data', data => {
        timer.refresh();
        this.processChunk(data);
      });

      hose.on('error', stream_error => {
        error = stream_error;
        hose_cleanup();
        reject(error);
      });
    });
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
      return this.buildStreamPromise(resp);
    });
  }
}

module.exports = StreamClient;
