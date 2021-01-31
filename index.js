const DevNull = require('dev-null-stream')
const axios = require('axios');
const EventEmitter = require('events');
const TweetParser = require('./lib/parse_stream');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream/promises');
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
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
    //delta = 1.0 - delta;
    backoff = Math.max(Math.floor(delta * RATE_LIMIT_WINDOW), 1000);
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
 * @fires StreamClient#stream-error
 * @fires StreamClient#api-errors
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
   * @param {number} config.max_reconnects Specify max number of reconnects. Default: -1 (infinity)
   * @returns {(Promise<void>)} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
   * -- the Promise rejects if the number of reconnects exceeds the max or an irrecoverable error occurs
   * -- the Promise resolves with that last error returned. Error object defines .reconnects if reconnects are exceeded
   * @see retriableStatus
   */
  async connect({ params = {}, max_reconnects = -1, writeable_stream = null} = {}) {
    let reconnects = -1;
    let last_try = Date.now();
    let last_error;

    while(max_reconnects === -1 || reconnects <= max_reconnects)
    {
      reconnects += 1;
      this.params = params;
      this.max_reconnects = max_reconnects;
      try {
        await this.buildConnection(this.params, writeable_stream);
      } catch(request_error) {
        let resp = request_error.response;
        if(axios.isCancel(request_error)) {
          return Promise.resolve();
        } else if(isTimedout(request_error) || resp && retriableStatus(resp)) {
          let timeout_wait = rateLimiting(resp, last_try);
          this.emit('reconnect', request_error, timeout_wait);
          if(!this.skip_sleep) {
            await sleep(timeout_wait);
          }
        } else {
          return Promise.reject(request_error);
        }
      }
      last_try = Date.now();
    }

    let reject_error = new Error({
      message: `Max reconnects exceeded (${reconnects})`,
      wrapped_error: last_error
    })
    reject_error.reconnects = reconnects;
    return Promise.reject(reject_error);
  }

  /**
   * Disconnects an active request if any
   * @returns {boolean} Returns true if there is a request to disconnect
   */
  disconnect() {
    this.emit('disconnected');
    if(this.cancelToken) {
      this.cancelToken.cancel('Disconnecting stream');
      this.cancelToken = null;
      return true;
    } else {
      return false;
    }
  }

  /**
   * Build Promises for handling data stream in [.buildConnection]{@link StreamClient#buildConnection}
   * @private
   * @returns {Promise} Promise that initiates HTTP streaming
   */
  buildStreamPromise(resp, writable_stream) {
    const hose = resp.data;
    const timer = setTimeout(() => {
      const e = new Error(`Timed out after ${this.stream_timeout / 1000} seconds of no data`);
      e.isTimeout = true;
      hose.destroy(e);
      clearTimeout(timer);
    }, this.stream_timeout);
    const jsonStream = new TweetParser({
      emitter: this,
      timer: timer
    });
    const streams = [hose, jsonStream];
    if(writable_stream) {
      streams.push(writable_stream);
    } else {
      streams.push(new DevNull());
    }
    let listener = () => {
      hose.end();
    }

    this.once('disconnected', listener);
    let thicc = pipeline(...streams);
    thicc.finally(() => clearTimeout(timer));
    this.emit('connected');
    return thicc;
  }

  /**
   * Connect to twitter stream and emit events. Errors unhandled.
   * @private
   * @returns {Promise} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
   * -- the Promise chain is unhandled so consider using [.connect]{@link StreamClient#connect}
   */
  buildConnection(params, writable_stream) {
    if(this.cancelToken) {
      this.disconnect();
    }
    this.cancelToken = axios.CancelToken.source();

    let streamReq = this.twitrClient.get('tweets/sample/stream', {
      responseType: 'stream',
      cancelToken: this.cancelToken.token,
      params: params,
      decompress: true,
      httpAgent: new http.Agent({ keepAlive: true }),
      httpsAgent: new https.Agent({ keepAlive: true }),
      timeout: 0,
      maxContentLength: Infinity,
    });

    return streamReq.then((resp) => {
      return this.buildStreamPromise(resp, writable_stream);
    });
  }
}

module.exports = StreamClient;
