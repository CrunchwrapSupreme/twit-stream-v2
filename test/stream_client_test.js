/* eslint-disable max-lines-per-function */
/* eslint-disable func-names */
const StreamClient = require('../index');
const PassThroughStream = require('stream').PassThrough;

describe('StreamClient', function() {
  this.timeout(10000);

  describe('#buildStreamPromise(response)', function () {
    it('should resolve when #disconnect() is called', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.buildStreamPromise(response_mock)
        .then(done)
        .catch((e) => done(e));
      setTimeout(() => client.disconnect(), 50);
      stream.end();
    });

    it('should emit tweet without a timeout when it is streamed in', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.on('tweet', () => done());
      client.buildStreamPromise(response_mock).catch((e) => done(e));
      stream.write(`{"data":{"test":"dave"}}\r\n`);
      stream.end();
    });

    it('should reject with an error when stream emits error', function(done) {
      let client = new StreamClient({token: 'abcdef'});
      let stream = new PassThroughStream();
      let response_mock = { data: stream };
      client.buildStreamPromise(response_mock)
        .then(() => {
          done(new Error('Stream didnt reject'));
        })
        .catch(() => done());
      stream.emit('error', new Error('Fake error'));
      stream.end();
    });
  });

  describe('#connect({ params: object, max_connects: number})', function() {
    it('should reject after max_reconnects attempts', function(done) {
      let client = new StreamClient({
        token: 'abcdef',
        timeout: 1
      });

      client.buildConnection = () => {
        let error_fake = new Error('Fake retriable error');
        error_fake.status = 429;
        return Promise.reject(error_fake);
      };

      client.connect({max_reconnects: -2})
        .then(() => {
          done(new Error('Did not reject'));
        })
        .catch((error) => {
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

      setTimeout(() => client.disconnect(), 50);
    });

    it('should reject on unretriable error', function(done) {
      let client = new StreamClient({
        token: 'abcdef',
        timeout: 1000
      });

      client.skip_sleep = true;
      client.buildConnection = () => {
        let error_fake = new Error('Retriable error should not throw');
        error_fake.status = 420;
        return Promise.reject(error_fake);
      };

      client.connect({max_reconnects: 1})
        .then(() => {
          done(new Error('Did not reject'));
        })
        .catch((error) => {
          if(error.reconnects) {
            done(error);
          } else {
            done();
          }
        });
    });
  });
});
