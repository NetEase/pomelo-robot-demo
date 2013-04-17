var queryHero = require('./../../app/data/mysql').queryHero;
var envConfig = require('./../../app/config/env.json');
var config = require('./../../app/config/'+envConfig.env+'/config');
var mysql = require('mysql');

// pomelo client js
var WebSocket = require('ws');
var Protocol = require('pomelo-protocol');
var Package = Protocol.Package;
var Message = Protocol.Message;
var EventEmitter = require('events').EventEmitter;
var protocol = require('pomelo-protocol');
var protobuf = require('pomelo-protobuf');

var JS_WS_CLIENT_TYPE = 'js-websocket';
var JS_WS_CLIENT_VERSION = '0.0.1';

var RES_OK = 200;
var RES_FAIL = 500;
var RES_OLD_CLIENT = 501;


  if (typeof Object.create !== 'function') {
    Object.create = function (o) {
      function F() {}
      F.prototype = o;
      return new F();
    };
  }

  var pomelo = Object.create(EventEmitter.prototype); // object extend from object
  var socket = null;
  var reqId = 0;
  var callbacks = {};
  var handlers = {};
  //Map from request id to route
  var routeMap = {};

  var heartbeatInterval = 5000;
  var heartbeatTimeout = heartbeatInterval * 2;
  var heartbeatId = null;
  var heartbeatTimeoutId = null;

  var handshakeCallback = null;

  var handshakeBuffer = {
    'sys': {
      type: JS_WS_CLIENT_TYPE,
      version: JS_WS_CLIENT_VERSION
    },
    'user': {
    }
  };

  var initCallback = null;

  pomelo.init = function(params, cb){
    initCallback = cb;
    var host = params.host;
    var port = params.port;

    var url = 'ws://' + host;
    if(port) {
      url +=  ':' + port;
    }

    handshakeBuffer.user = params.user;
    handshakeCallback = params.handshakeCallback;
    initWebSocket(url, cb);
  };

  var initWebSocket = function(url,cb){
    var onopen = function(event){
      var obj = Package.encode(Package.TYPE_HANDSHAKE, Protocol.strencode(JSON.stringify(handshakeBuffer)));
      send(obj);
    };
    var onmessage = function(event) {
      processPackage(Package.decode(event.data), cb);
    };
    var onerror = function(event) {
      pomelo.emit('io-error', event);
      console.log('socket error: ', event);
    };
    var onclose = function(event){
      pomelo.emit('close',event);
      console.log('socket close: ', event);
    };
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = onopen;
    socket.onmessage = onmessage;
    socket.onerror = onerror;
    socket.onclose = onclose;
  };

  pomelo.disconnect = function() {
    if(socket) {
      if(socket.disconnect) socket.disconnect();
      if(socket.close) socket.close();
      socket = null;
    }

    if(heartbeatId) {
      clearTimeout(heartbeatId);
      heartbeatId = null;
    }
    if(heartbeatTimeoutId) {
      clearTimeout(heartbeatTimeoutId);
      heartbeatTimeoutId = null;
    }
  };

  pomelo.request = function(route, msg, cb) {
    if(arguments.length === 2 && typeof msg === 'function') {
      cb = msg;
      msg = {};
    } else {
      msg = msg || {};
    }
    route = route || msg.route;
    if(!route) {
      return;
    }

    reqId++;
    sendMessage(reqId, route, msg);

    callbacks[reqId] = cb;
    routeMap[reqId] = route;
  };

  pomelo.notify = function(route, msg) {
    msg = msg || {};
    sendMessage(0, route, msg);
  };

  var sendMessage = function(reqId, route, msg) {
    var type = reqId ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY;

    //compress message by protobuf
    var protos = !!pomelo.data.protos?pomelo.data.protos.client:{};
    if(!!protos[route]){
      msg = protobuf.encode(route, msg);
    }else{
      msg = Protocol.strencode(JSON.stringify(msg));
    }


    var compressRoute = 0;
    if(pomelo.dict && pomelo.dict[route]){
      route = pomelo.dict[route];
      compressRoute = 1;
    }

    msg = Message.encode(reqId, type, compressRoute, route, msg);
    var packet = Package.encode(Package.TYPE_DATA, msg);
    send(packet);
  };

  

  var handler = {};

  var heartbeat = function(data) {
    var obj = Package.encode(Package.TYPE_HEARTBEAT);
    if(heartbeatTimeoutId) {
      clearTimeout(heartbeatTimeoutId);
      heartbeatTimeoutId = null;
    }

    if(heartbeatId) {
      // already in a heartbeat interval
      return;
    }

    heartbeatId = setTimeout(function() {
      heartbeatId = null;
      send(obj);

      heartbeatTimeoutId = setTimeout(function() {
        console.error('server heartbeat timeout');
        pomelo.emit('heartbeat timeout');
        pomelo.disconnect();
      }, heartbeatTimeout);
    }, heartbeatInterval);
  };

  var handshake = function(data){
    data = JSON.parse(Protocol.strdecode(data));
    if(data.code === RES_OLD_CLIENT) {
      pomelo.emit('error', 'client version not fullfill');
      return;
    }

    if(data.code !== RES_OK) {
      pomelo.emit('error', 'handshake fail');
      return;
    }

    handshakeInit(data);

    var obj = Package.encode(Package.TYPE_HANDSHAKE_ACK);
    send(obj);
    if(initCallback) {
      initCallback(socket);
      initCallback = null;
    }
  };

  var onData = function(data){
    //probuff decode
    //var msg = Protocol.strdecode(data);
    var msg = Message.decode(data);

    if(msg.id > 0){
      msg.route = routeMap[msg.id];
      delete routeMap[msg.id];
      if(!msg.route){
        return;
      }
    }

    msg.body = deCompose(msg);

    processMessage(pomelo, msg);
  };

  var onKick = function(data) {
    pomelo.emit('onKick');
  };

  handlers[Package.TYPE_HANDSHAKE] = handshake;
  handlers[Package.TYPE_HEARTBEAT] = heartbeat;
  handlers[Package.TYPE_DATA] = onData;
  handlers[Package.TYPE_KICK] = onKick;

  var processPackage = function(msg){
    handlers[msg.type](msg.body);
  };

  var processMessage = function(pomelo, msg) {
    if (!msg) return;
    if(!!msg && msg.id) {
    } else {
      // server push message
      pomelo.emit(msg.route, msg.body);
      return;
    }

    //if have a id then find the callback function with the request
    var cb = callbacks[msg.id];

    delete callbacks[msg.id];
    if(typeof cb !== 'function') {
      return;
    }

    cb(msg.body);
    return;
  };

  var processMessageBatch = function(pomelo, msgs) {
    for(var i=0, l=msgs.length; i<l; i++) {
      processMessage(pomelo, msgs[i]);
    }
  };

  var deCompose = function(msg){
    var protos = !!pomelo.data.protos?pomelo.data.protos.server:{};
    var abbrs = pomelo.data.abbrs;
    var route = msg.route;

    //Decompose route from dict
    if(msg.compressRoute) {
      if(!abbrs[route]){
        return {};
      }

      route = msg.route = abbrs[route];
    }
    if(!!protos[route]){
      return protobuf.decode(route, msg.body);
    }else{
      return JSON.parse(Protocol.strdecode(msg.body));
    }

    return msg;
  };

  var handshakeInit = function(data){
    if(data.sys && data.sys.heartbeat) {
      heartbeatInterval = data.sys.heartbeat;       // heartbeat interval
      heartbeatTimeout = heartbeatInterval * 2;     // max heartbeat timeout
    }

    initData(data);

    if(typeof handshakeCallback === 'function') {
      handshakeCallback(data.user);
    }
  };

  //Initilize data used in pomelo client
  var initData = function(data){
    if(!data || !data.sys) {
      return;
    }
    pomelo.data = pomelo.data || {};
    var dict = data.sys.dict;
    var protos = data.sys.protos;

    //Init compress dict
    if(dict){
      pomelo.data.dict = dict;
      pomelo.data.abbrs = {};

      for(var route in dict){
        pomelo.data.abbrs[dict[route]] = route;
      }
    }

    //Init protobuf protos
    if(protos){
      pomelo.data.protos = {
        server : protos.server || {},
        client : protos.client || {}
      };
      if(!!protobuf){
        protobuf.init({encoderProtos: protos.client, decoderProtos: protos.server});
      }
    }
  };

// pomelo client js end ====

var send = function(packet){
   if (!!socket) {
    socket.send(packet.buffer || packet,{binary: true, mask: true});
   } else {
    setTimeout(function(){
      entry(_host,_port,_token,function(){console.log(' send is null re entry ')});
    },3000);
   }
};

var client = mysql.createConnection({
  host: config.mysql.host,
  user: config.mysql.user,
  port:config.mysql.port,
  password: config.mysql.password,
  database: config.mysql.database
});


var START = 'start';
var END = 'end';

var monitor = function(type,name,reqId){
  if (typeof actor!='undefined') {
    actor.emit(type,name,reqId);
  } else {
    console.error(Array.prototype.slice.call(arguments,0));
  }
}

var connected = false;

var offset = (typeof actor!='undefined') ? actor.id : 1;

var _host = "";
var _port = "";
var _toke = "";

queryHero(client,1,offset,function(error,users){
   var user = users[0];
   client.end();
    queryEntry(user.uid,function(host,port){
     entry(config.apps.host,port,user.token,function(){
      connected = true;
    });
  });
});

function queryEntry(uid, callback) {
  pomelo.init({host: config.apps.host, port: config.apps.port, log: true}, function() {
        pomelo.request('gate.gateHandler.queryEntry', { uid: uid}, function(data) {
          pomelo.disconnect();
          if(data.code === 2001) {
            alert('Servers error!');
            return;
          }
          callback(data.host, data.port);
        });
  });
}

function entry(host, port, token, callback) {
      //初始化socketClient
        _host = host; _port = port; _token = token;
        if (socket!=null) return;
        pomelo.init({host: host, port: port, log: true}, function() {
        monitor(START,'entry',1);
        pomelo.request('connector.entryHandler.entry', {token: token}, function(data) {
          //var player = data.player;
          monitor(END,'entry',1);  
          if (callback) {
            callback(data.code);
          }

          if (data.code == 1001) {
            alert('Login fail!');
            return;
          } else if (data.code == 1003) {
            alert('Username not exists!');
            return;
          }

          if (data.code != 200) {
            alert('Login Fail!');
            return;
          }

          // init handler
          //loginMsgHandler.init();
         //gameMsgHandler.init();
           afterLogin(pomelo,data);
        });
      });
}


var afterLogin = function(pomelo,data){
  pomelo.player = null;
  pomelo.players = {};
  pomelo.entities = {};
  pomelo.isDead = false;
  pomelo.lastAttack = null;
  pomelo.bags = [];
  pomelo.equipments = [];
  pomelo.areas = [];
  pomelo.skills = [];
  var fightedMap = {};

//set debug level
//robot.logLevel(1);
pomelo.on('onKick', function() {
  console.log('You have been kicked offline for the same account logined in other place.');
});

pomelo.on('disconnect', function(reason) {
  console.log('disconnect invoke!' + reason);
});
 
var msgTempate = {scope:'D41313',content:'老子要杀怪了'};
/**
 * 处理登录请求
 */
var login = function(data){
  var player = data.player;
  if (player.id <= 0) { 
   console.log("用户不存在\n uid:" + uid + " code:" + data.code);
} else {
   pomelo.uid = player.userId;
   pomelo.player = player;
   msgTempate.uid = pomelo.uid;
   msgTempate.playerId = pomelo.player.id;
   msgTempate.from = pomelo.player.name,
   msgTempate.areaId = pomelo.player.areaId;
   setTimeout(function(){
    enterScene();
   },1000);
 }
};

login(data);

var enterScene = function() {
	var msg = {uid:pomelo.uid, playerId: pomelo.player.id, areaId: pomelo.player.areaId};
  monitor(START,'enterScene',2);
	pomelo.request("area.playerHandler.enterScene",msg,enterSceneRes);
}

var enterSceneRes = function(data) {
  console.log('enter secene')
  monitor(END,'enterScene',2);
  pomelo.entities = data.entities;
  pomelo.player = data.curPlayer;
  var moveRandom = Math.floor(Math.random()*3+1);
  var intervalTime = 2000+Math.round(Math.random()*3000);
  if (moveRandom<=2) {
    setInterval(function(){moveEvent()},intervalTime);
    console.log(' mover,name=' + pomelo.player.name + ' ' + pomelo.player.entityId);
  } else { 
    setInterval(function(){attackEvent()},intervalTime);
    console.log(' fighter,name=' + pomelo.player.name + ' ' + pomelo.player.entityId);
  }
}


var sendChat = function() {
  pomelo.request('chat.chatHandler.send',msgTempate,okRes);
}

/**
 * 处理用户离开请求
 */
 pomelo.on('onUserLeave',function(data){
    //console.log("用户离开: " + JSON.stringify(data));
    var player = pomelo.players[data.playerId];
    if (!!player) {
    clearAttack(player);
    delete pomelo.entities[player.entityId]
    delete player;
  }
});


pomelo.on('onAddEntities', function(entities){
    //console.log('onAddEntities%j',entities);
    for(var key in entities){
        var array = entities[key];
        var typeEntities = pomelo.entities[key] || [];
        for(var i = 0; i < array.length; i++){
           //duplicate
          typeEntities.push(array[i]);
        }
        pomelo.entities[key] = typeEntities;
      }
});

/**
 * Handle remove entities message
 * @param data {Object} The message, contains ids to remove
 */
 pomelo.on('onRemoveEntities', function(data){
  var entities = data.entities;
  for(var i = 0; i < entities.length; i++){
    var entityId = entities[i];
    removeEntities(entityId);
  }
});

var removeEntities = function(entityId){
    for(var key in pomelo.entities){
        var array = pomelo.entities[key];
        var typeEntities = pomelo.entities[key] || [];
        var indexs = [];
        for(var i = 0;i<typeEntities.length;i++){
           var exists = typeEntities[i];
           if (exists.entityId===entityId){
              indexs.push(i);
           }
        }
        for(var i = 0;i<indexs.length;i++){
            typeEntities.splice(i,1);
        }
    }
}
/**
 * 处理用户攻击请求
 */
 pomelo.on('onAttack',function(data){
  //console.log("fighting: " + JSON.stringify(data));
  if (data.result.result === 2) {
    var attackId = parseInt(data.attacker);
    var targetId = parseInt(data.target);
    var selfId = parseInt(pomelo.player.entityId);
    if (attackId === selfId || targetId === selfId) {
      if (targetId !== selfId){
        clearAttack();
        pomelo.isDead = false;
        removeEntities(targetId);
      }  else {
        pomelo.isDead = true;
        clearAttack();
      }
    } else {
      if (!!pomelo.lastAttAck && targetId === pomelo.lastAttAck.entityId) {
        clearAttack();
      } 
    removeEntities(targetId);
  }
}
});


 pomelo.on('onRevive', function(data){
  if (data.entityId === pomelo.player.entityId) {
    pomelo.isDead = false;
    clearAttack();
    //console.log(' ON revive %j',pomelo.player.id + ' ' + pomelo.uid);
  }
});


pomelo.on('onUpgrade' , function(data){
  msgTempate.content = 'NB的我升级了，羡慕我吧';
  sendChat();
  return;
  if (data.player.id===pomelo.player.id){   
      msgTempate.content = 'NB的我升'+data.player.level+'级了，羡慕我吧';
      pomelo.level = data.player.level;    
      sendChat();
    }
});


 pomelo.on('onDropItems' , function(data) {
  var items = data.dropItems;
  for (var i = 0; i < items.length; i ++) {
    var item = items[i];
    pomelo.entities[item.entityId] = item;
  }
});
 

 pomelo.on('onMove',function(data){ 
  var entity = pomelo.entities[data.entityId];
  if (!entity) {return;}
  if (data.entityId ===pomelo.player.entityId) {
    var path = data.path[1];
    pomelo.player.x = path.x;
    pomelo.player.y = path.y;
    console.log(' self %j move to x=%j,y=%j',pomelo.uid,path.x,path.y);
  }
  pomelo.entities[data.entityId] = entity;    
});
 
var moveDirection = 1+Math.floor(Math.random()*7);

 var getPath = function() {
  var FIX_SPACE = Math.round(Math.random()*pomelo.player.walkSpeed);
  var startX = pomelo.player.x;
  var startY = pomelo.player.y;
  var endX = startX;
  var endY = startY;
  switch(moveDirection) {
    case 1:
    endX+=FIX_SPACE;break;
    case 2:
    endX+=FIX_SPACE;
    endY+=FIX_SPACE;
    break;
    case 3:
    endY+=FIX_SPACE;
    break;
    case 4:
    endY+=FIX_SPACE;
    endX-=FIX_SPACE;
    break;
    case 5:
    endX-=FIX_SPACE;
    break;
    case 6:
    endX-=FIX_SPACE;
    endY-=FIX_SPACE;
    break;
    case 7 :
    endX-=FIX_SPACE;
    break;
    case 8 :
    default:
    endX+=FIX_SPACE;
    endY-=FIX_SPACE;
    break;
  }
  var path = [{x: startX, y: startY}, {x:endX, y:endY}];
  return path;
}

var getFightPlayer = function(type) {
  var typeEntities = pomelo.entities[type];
  if (!typeEntities){return null;}
  var randomNum = Math.floor(Math.random()*typeEntities.length);
  var entity =  typeEntities[randomNum];
  if (!!entity) {
    entity.type = type;
  } else {
    for (var i = 0;i<typeEntities.length;i++){
      console.log(typeEntities[i] + ' ' + i);
    }
  }
  return entity;
}

var getFirstFight = function() {
  var nearEntity = getFightPlayer('mob');
  if (!nearEntity) { nearEntity = getFightPlayer('item')};
  if (!nearEntity) { nearEntity = getFightPlayer('player')};
  return nearEntity;
}

var okRes = function(){

}

var requestId = 10; 

var moveEvent = function() {
  if (!!pomelo.isDead) {return;}
  var paths= getPath();
  var msg = {path:paths};
  var reqId = requestId++;
  monitor(START,'move',reqId);
  pomelo.request('area.playerHandler.move',msg,function(data){
    monitor(END,'move',reqId);
    if (data.code !=200) {
      //console.error('wrong path %j entityId= %j',msg,pomelo.player.entityId);
      return moveDirection++;
    }
    pomelo.player.x = paths[1].x;
    pomelo.player.y = paths[1].y;
    if (moveDirection>=8){ moveDirection = 1+Math.floor(Math.random()*5);}
  });
}


var attackEvent = function(){
  if (!pomelo.player.entityId || !!pomelo.isDead ) {
    return;
  }
  var entity = pomelo.lastAttAck;
  if (!!entity) {
      attack(entity);
      var count = fightedMap[entity.entityId] ||1;
      fightedMap[entity.entityId] = (count+1);
      if (count>=10) {
        delete fightedMap[entity.entityId];
        clearAttack(entity);
      }
  } else {
     attack(getFirstFight());
  }
};

 
var attack = function(entity) {
  if (!entity) {return;}
  if (entity.type === 'mob') {
    pomelo.lastAttAck = entity;
    var attackId = entity.entityId;
    var skillId = 1;
    var route = 'area.fightHandler.attack';
    var areaId = pomelo.player.areaId;
    var attackReqId = requestId++;
    var msg = {areaId:areaId,playerId: pomelo.player.id, targetId:attackId, skillId: skillId};
    monitor(START,'attack',attackReqId);
    pomelo.request(route,msg,function(data){
      monitor(END,'attack',attackReqId);
    });
  } else if (entity.type === 'item' || entity.type === 'equipment') {
    var route = 'area.playerHandler.pickItem';
    var attackId = entity.entityId;
    var msg = { areaId:pomelo.player.areaId, playerId:pomelo.player.id, targetId:attackId};
    //console.log(' begin pickup == %j , %j ',entity.type,msg); 
    var pickItemReqId = requestId++;
    monitor(START,'pickItem',attackReqId);
    pomelo.request(route,msg,function(data){
      monitor(END,'pickItem',pickItemReqId);
    });
  }
}

/*
 *ITEM ACTION
 *
 */
 pomelo.on('onPickItem', function(data){
  clearAttack(data.item);
  var item = pomelo.entities[data.item];
    //console.log('pic %j',data);
    if (!!item && data.player===pomelo.player.entityId) {
      msgTempate.content = '捡到一个XXOO的'+ item.kindName+'玩意';
      sendChat(msgTempate);
  }
  delete item;
});

 pomelo.on('onRemoveItem', function(data){
  clearAttack(data);
  delete pomelo.entities[data.entityId];
});

var clearAttack = function(data){
   pomelo.lastAttAck = null;
}

var removeAttack = function(){
  pomelo.lastAttAck = null;
}





};