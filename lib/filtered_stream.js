const StreamClient = require('./stream_client');
const DATA_TIMEOUT = 30000;
const RULES_TIMEOUT = 5000;

/**
 * Client for interfacing with filtered stream API
 */
class FilteredStream extends StreamClient {
  constructor({token, timeout = DATA_TIMEOUT, stream_timeout = DATA_TIMEOUT}) {
    super({
      token: token,
      timeout: timeout,
      stream_timeout: stream_timeout
    });
    this.url = 'tweets/search/stream';
  }

  /**
   * Add rule for filtered stream
   */
  addRule(rules) {
    let data = { add: rules };
    return this.twitrClient.post('/tweets/search/stream/rules', data, {
      timeout: RULES_TIMEOUT,
      responseType: 'json'
    });
  }

  /**
   * Clear rules for filtered stream
   */
  async clearRules() {
    let res = await this.rules();
    if(res.data && 'data' in res.data) {
      const has_id = (e) => { return 'id' in e; }
      let data = res.data.data;
      if(!Array.isArray(data) || !data.every(has_id)) {
        return Promise.reject(res);
      }
      let rules = data.map((r) => r.id);
      return this.deleteRules(rules);
    } else {
      return Promise.reject(res)
    }
  }

  /**
   * List rules for filtered stream
   */
  rules() {
    return this.twitrClient.get('/tweets/search/stream/rules', {
      timeout: RULES_TIMEOUT,
      responseType: 'json'
    });
  }

  /**
   * Delete rules for filtered stream
   */
  deleteRules(ruleids) {
    let data = { delete: { ids: ruleids } };
    return this.twitrClient.post('/tweets/search/stream/rules', data, {
      timeout: RULES_TIMEOUT,
      responseType: 'json'
    });
  }
}

module.exports = FilteredStream;
