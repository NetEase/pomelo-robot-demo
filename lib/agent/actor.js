var util = require('util');
var vm = require('vm');
var EventEmitter = require('events').EventEmitter;
var monitor = require('../monitor/monitor');

var Actor = function(conf,aid) {
  EventEmitter.call(this);
  this.id = aid;
  this.log = conf.log || console;
  this.conf = conf;
  var self = this;
  self.on('start',function(action,reqId){
    monitor.beginTime(action,self.id,reqId);
  });
  self.on('end',function(action,reqId){
    monitor.endTime(action,self.id,reqId);
  });
  self.on('incr',function(action){
    monitor.incr(action);
  });
  self.on('decr',function(action){
    monitor.decr(action);
  });
};
 
util.inherits(Actor, EventEmitter);

var pro = Actor.prototype;

pro.run = function() {
  var initSandbox = {
        console:console,
        require:require,
        actor:this,
        setTimeout:setTimeout,
        setInterval:setInterval,
        clearTimeout:clearTimeout,
        Math:Math,
        Date:Date
  };
    try {
    var context = vm.createContext(initSandbox);
    vm.runInContext(this.conf.script,context);
  } catch(ex){
    this.emit('error',ex.stack);
  }
};
 
pro.reset = function() {
   monitor.clear();
};

/**
	* output debug info
	*
	*/
pro.logger = function(msg){
		this.log.debug(JSON.stringify(msg));
}

/**
  * set log level
  *
  */

pro.logLevel = function(level) {
		this.log.set(level);
}

/**
 * wrap setTimeout
 *
 *@param {Function} fn
 *@param {Number} time
 */
pro.later = function(fn,time){
  if (time>0 && typeof(fn)=='function') {
    return setTimeout(fn,time);
  }
};

/**
 * wrap setInterval 
 * when time is Array, the interval time is thd random number
 * between then
 * 
 *@param {Function} fn
 *@param {Number} time
 */
pro.interval = function(fn,time){
  var fn = arguments[0];
  var self = this;
  switch (typeof(time)) {
  case 'number':
    if (arguments[1]>0)	return setInterval(fn,arguments[1]);
    break;
  case 'object':
    var start = time[0], end = time[1];
    var time = Math.round(Math.random()*(end-start) +start);
    return setTimeout(function(){fn(),self.interval(fn,time);},time); 
    break;
  default:
    self.log.error('wrong argument');
    return;
  }
};

/**
 *wrap clearTimeout
 *
 * @param {Number} timerId
 *
 */
pro.clean = function(timerId){
  clearTimeOut(timerId);
}

/**
 *encode message
 *
 * @param {Number} id
 * @param {Object} msg
 *
 */

exports.Actor = Actor;
