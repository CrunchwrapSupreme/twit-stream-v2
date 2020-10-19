/* eslint-disable max-lines-per-function */
/* eslint-disable func-names */
const StreamClient = require('../index');
const JParseStream = require('../lib/parse_stream');
const PassThroughStream = require('stream').PassThrough;

describe('StreamClient', function() {
  this.timeout(10000);

  describe('#parseJSON(chunk)', function() {
    it('should process a chunk of tweet JSON and emit a tweet event', function(done) {
      let stream = new PassThroughStream();
      let client = new JParseStream();
      stream.pipe(client);
      client.on('tweet', () => done());
      client.on('stream-error', (e) => done(e));
      stream.write(`{"data": {"test":"dave"}}\r\n`, 'utf8');
      stream.destroy();
    });

    it('should process a chunk of invalid JSON and emit an stream-error event', function(done) {
      let stream = new PassThroughStream();
      let client = new JParseStream();
      stream.pipe(client);
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('stream-error', () => done());
      stream.write(`{"data": "test":"dave"}}\r\n`);
      stream.destroy();
    });

    it('should process a chunk of error JSON and emit an stream-error event', function(done) {
      let stream = new PassThroughStream();
      let client = new JParseStream();
      stream.pipe(client);
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('api-errors', () => done());
      stream.write(`{"errors": {"test":"dave"}}\r\n`);
      stream.destroy();
    });

    it('should process a chunk of unknown JSON and emit an stream-error event', function(done) {
      let stream = new PassThroughStream();
      let client = new JParseStream();
      stream.pipe(client);
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('stream-error', (e) => done(e));
      client.on('other', () => done());
      stream.write(`{"other": {"test":"dave"}}\r\n`);
      stream.destroy();
    });

    it('should process a heartneat and emit a heartbeat event', function(done) {
      let stream = new PassThroughStream();
      let client = new JParseStream();
      stream.pipe(client);
      client.on('tweet', () => done(new Error('Should not emit a tweet')));
      client.on('stream-error', (e) => done(e));
      client.on('heartbeat', () => done());
      stream.write(`\r\n`);
      stream.destroy();
    });
  });

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
