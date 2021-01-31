const { Transform } = require('stream');
const MAX_BUFFER_SIZE = 1024 * 1024 * 50;

class TweetStreamParser extends Transform {
  constructor(options) {
    super({
      ...options,
      readableObjectMode: true
    });

    if(options) {
      this.emitr = options.emitter;
      this.timer = options.timer;
    }
    this.emitr = this.emitr || this;
  }

  parseJSON() {
    const EOF = '\r\n';
    const emitter = this.emitr;
    let error, index;
    while( (index = this.chunkBuffer.indexOf(EOF, 'utf8')) > -1 ) {
      let chunk = this.chunkBuffer.toString('utf8', 0, index);
      this.chunkBuffer = this.chunkBuffer.slice(index + EOF.length);

      if(chunk.length > 0) {
        try {
          let json = JSON.parse(chunk);
          if(json.data) {
            emitter.emit('tweet', json);
            this.push(json);
          } else if(json.errors) {
            emitter.emit('api-errors', json);
          } else {
            emitter.emit('other', json);
          }
        } catch(json_error) {
          json_error.source = chunk;
          error = json_error;
          this.emit('stream-error', error);
        }
      } else {
        emitter.emit('heartbeat');
        this.push();
      }
    }
  }

  _transform(chunk, encoding, callback) {
    this.encoding = encoding;
    let op_error;
    if(this.chunkBuffer && this.chunkBuffer.length > MAX_BUFFER_SIZE) {
      const err_info = {
        lastChunk: chunk,
        buffer: this.chunkBuffer,
        max_size_b: MAX_BUFFER_SIZE
      };
      op_error = new Error(`Stream overproducing tweet data\n${err_info}`);
    } else if(this.chunkBuffer && chunk) {
      this.chunkBuffer = Buffer.concat([this.chunkBuffer, chunk]);
    } else if(chunk) {
      this.chunkBuffer = chunk;
    }
    this.parseJSON();
    if(this.timer) {
      this.timer.refresh();
    }
    callback(op_error);
  }

  /**
   * Clear the chunk buffer
   */
  _flush(callback) {
    let error;
    if(this.chunkBuffer) {
      this.parseJSON();
      this.chunkBuffer = null;
    }
    callback(error);
  }
}

module.exports = TweetStreamParser;
