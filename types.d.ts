declare module "twitv2-stream" {
    export = StreamClient;
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
     * @fires StreamClient#api-errors
     * @fires StreamClient#heartbeat
     * @fires StreamClient#other
     */
    class StreamClient {
        /**
         * Initializes the client
         * @param {Object} config Configuration for client
         * @param {number} config.timeout Set request and response timeout
         * @param {string} config.token Set [OAUTH Bearer token]{@link https://developer.twitter.com/en/docs/authentication/oauth-2-0} from developer account
         */
        constructor({ token, timeout, stream_timeout }: {
            timeout: number;
            token: string;
        });
        timeout: number;
        twitrClient: any;
        stream_timeout: any;
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
        connect({ params, max_reconnects, writeable_stream }?: {
            params: number;
            max_reconnects: string;
        }): (Promise<object> | Promise<Error>);
        /**
         * Disconnects an active request if any
         * @returns {boolean} Returns true if there is a request to disconnect
         */
        disconnect(): boolean;
        cancelToken: any;
        /**
         * Build Promises for handling data stream in [.buildConnection]{@link StreamClient#buildConnection}
         * @private
         * @returns {Promise} Promise that initiates HTTP streaming
         */
        private buildStreamPromise;
        /**
         * Connect to twitter stream and emit events. Errors unhandled.
         * @private
         * @returns {Promise} Promise that resolves on [disconnect]{@link StreamClient#disconnect}
         * -- the Promise chain is unhandled so consider using [.connect]{@link StreamClient#connect}
         */
        private buildConnection;
    }
}
