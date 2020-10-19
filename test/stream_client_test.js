/* eslint-disable max-lines-per-function */
/* eslint-disable func-names */
const StreamClient = require('../index');
const PassThroughStream = require('stream').PassThrough;

describe('StreamClient', function() {
  this.timeout(10000);

  describe('#buildStreamPromise(response)', function () {
    it('should emit close when #disconnect() is called', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('close', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      setTimeout(() => client.disconnect(), 1000);
      stream.destroy();
    });

    it('should emit close when the response stream is destroyed', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('close', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      setTimeout(() => stream.destroy(), 1000);
      stream.destroy();
    });

    it('should emit tweet without a timeout when it is streamed in', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('tweet', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      stream.write(`{"data":{"test":"dave"}}\r\n`);
      stream.destroy();
    });

    it('should reject with an error when stream emits error', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.buildStreamPromise(response_mock).catch(() => done());
      stream.emit('error', new Error('Fake error'));
      stream.destroy();
    });
  });

  describe('#connect({ params: object, max_connects: number})', function() {
    it('should reject after max_reconnects attempts', function(done) {
      let client = new StreamClient({
        token: 'abcdef',
        timeout: 1
      });

      client.connect({max_reconnects: 1}).catch((error) => {
        if(error.reconnects) {
          done();
        } else {
          done(error);
        }
      });
    });

    it('should resolve on disconnect', function(done) {
      let client = new StreamClient({
        token: 'abcdef',
        timeout: 1000
      });

      client.connect({max_reconnects: 1})
        .then(() => done())
        .catch((error) => done(error));

      client.disconnect();
    });

    it('should reject on unretriable error', function(done) {
      let client = new StreamClient({
        token: 'abcdef',
        timeout: 1000
      });

      client.buildConnection = () => {
        let error_fake = new Error();
        error_fake.status = 401;
        return Promise.reject(error_fake);
      };

      client.connect({max_reconnects: 1}).catch((error) => {
        if(error.reconnects) {
          done(error);
        } else {
          done();
        }
      });
    });
  });
});
