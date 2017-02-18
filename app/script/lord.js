/////////////////////////////////////////////////////////////
var WebSocket = require('ws');
var Protocol = require('pomelo-protocol');
var Package = Protocol.Package;
var Message = Protocol.Message;
var EventEmitter = require('events').EventEmitter;
var protocol = require('pomelo-protocol');
var protobuf = require('pomelo-protobuf');
var cwd = process.cwd();
var utils = require(cwd + '/app/script/utils');
var moveStat = require(cwd + '/app/script/statistic').moveStat;
var attackStat = require(cwd + '/app/script/statistic').attackStat;
var areaStat = require(cwd + '/app/script/statistic').areaStat;
var util = require('util');

if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        function F() {
        }

        F.prototype = o;
        return new F();
    };
}

var JS_WS_CLIENT_TYPE = 'js-websocket';
var JS_WS_CLIENT_VERSION = '0.0.1';

var RES_OK = 200;
var RES_OLD_CLIENT = 501;

var pomelo = Object.create(EventEmitter.prototype); // object extend from object
var socket = null;
var reqId = 0;
var callbacks = {};
var handlers = {};
var routeMap = {};

var heartbeatInterval = 5000;
var heartbeatTimeout = heartbeatInterval * 2;
var nextHeartbeatTimeout = 0;
var gapThreshold = 100; // heartbeat gap threshold
var heartbeatId = null;
var heartbeatTimeoutId = null;

var handshakeCallback = null;

var handshakeBuffer = {
    'sys': {
        type: JS_WS_CLIENT_TYPE,
        version: JS_WS_CLIENT_VERSION
    },
    'user': {}
};

var initCallback = null;

pomelo.init = function (params, cb) {
    pomelo.params = params;
    params.debug = true;
    initCallback = cb;
    var host = params.host;
    var port = params.port;

    var url = 'ws://' + host;
    if (port) {
        url += ':' + port;
    }

    if (!params.type) {
        handshakeBuffer.user = params.user;
        handshakeCallback = params.handshakeCallback;
        this.initWebSocket(url, cb);
    }
};

pomelo.initWebSocket = function (url, cb) {
    console.log('initWebSocket-url: ',url);
    var onopen = function (event) {
        console.log('[pomeloclient.init] websocket connected!');
        var obj = Package.encode(Package.TYPE_HANDSHAKE, Protocol.strencode(JSON.stringify(handshakeBuffer)));
        send(obj);
    };
    var onmessage = function (event) {
        processPackage(Package.decode(event.data), cb);
        // new package arrived, update the heartbeat timeout
        if (heartbeatTimeout) {
            nextHeartbeatTimeout = Date.now() + heartbeatTimeout;
        }
    };
    var onerror = function (event) {
        pomelo.emit('io-error', event);
        console.error('socket error %j ', event);
    };
    var onclose = function (event) {
        pomelo.emit('close', event);
        console.warn('socket close %j ', event);
    };
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = onopen;
    socket.onmessage = onmessage;
    socket.onerror = onerror;
    socket.onclose = onclose;
};

pomelo.disconnect = function () {
    if (socket) {
        if (socket.disconnect) socket.disconnect();
        if (socket.close) socket.close();
        console.log('disconnect');
        socket = null;
    }

    if (heartbeatId) {
        clearTimeout(heartbeatId);
        heartbeatId = null;
    }
    if (heartbeatTimeoutId) {
        clearTimeout(heartbeatTimeoutId);
        heartbeatTimeoutId = null;
    }
};

pomelo.request = function (route, msg, cb) {
    msg = msg || {};
    route = route || msg.route;
    if (!route) {
        console.log('fail to send request without route.');
        return;
    }

    reqId++;
    sendMessage(reqId, route, msg);

    callbacks[reqId] = cb;
    routeMap[reqId] = route;
};

pomelo.notify = function (route, msg) {
    msg = msg || {};
    sendMessage(0, route, msg);
};

var sendMessage = function (reqId, route, msg) {
    var type = reqId ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY;

    //compress message by protobuf
    var protos = !!pomelo.data.protos ? pomelo.data.protos.client : {};
    if (!!protos[route]) {
        msg = protobuf.encode(route, msg);
    } else {
        msg = Protocol.strencode(JSON.stringify(msg));
    }

    var compressRoute = 0;
    if (pomelo.dict && pomelo.dict[route]) {
        route = pomelo.dict[route];
        compressRoute = 1;
    }
    console.info('sendMessage: ',reqId, route, msg);

    msg = Message.encode(reqId, type, compressRoute, route, msg);
    var packet = Package.encode(Package.TYPE_DATA, msg);
    send(packet);
};


var _host = "";
var _port = "";
var _token = "";

/*
 var send = function(packet){
 if (!!socket) {
 socket.send(packet.buffer || packet,{binary: true, mask: true});
 } else {
 setTimeout(function() {
 entry(_host, _port, _token, function() {console.log('Socket is null. ReEntry!')});
 }, 3000);
 }
 };
 */

var send = function (packet) {
    if (!!socket) {
        socket.send(packet.buffer || packet, {binary: true, mask: true});
    }
};


var handler = {};

var heartbeat = function (data) {
    var obj = Package.encode(Package.TYPE_HEARTBEAT);
    if (heartbeatTimeoutId) {
        clearTimeout(heartbeatTimeoutId);
        heartbeatTimeoutId = null;
    }

    if (heartbeatId) {
        // already in a heartbeat interval
        return;
    }

    heartbeatId = setTimeout(function () {
        heartbeatId = null;
        send(obj);

        nextHeartbeatTimeout = Date.now() + heartbeatTimeout;
        heartbeatTimeoutId = setTimeout(heartbeatTimeoutCb, heartbeatTimeout);
    }, heartbeatInterval);
};

var heartbeatTimeoutCb = function () {
    var gap = nextHeartbeatTimeout - Date.now();
    if (gap > gapThreshold) {
        heartbeatTimeoutId = setTimeout(heartbeatTimeoutCb, gap);
    } else {
        console.error('server heartbeat timeout');
        pomelo.emit('heartbeat timeout');
        pomelo.disconnect();
    }
};

var handshake = function (data) {
    data = JSON.parse(Protocol.strdecode(data));
    if (data.code === RES_OLD_CLIENT) {
        pomelo.emit('error', 'client version not fullfill');
        return;
    }

    if (data.code !== RES_OK) {
        pomelo.emit('error', 'handshake fail');
        return;
    }

    handshakeInit(data);

    var obj = Package.encode(Package.TYPE_HANDSHAKE_ACK);
    send(obj);
    if (initCallback) {
        initCallback(socket);
        initCallback = null;
    }
};

var onData = function (data) {
    //probuff decode
    var msg = Message.decode(data);

    if (msg.id > 0) {
        msg.route = routeMap[msg.id];
        delete routeMap[msg.id];
        if (!msg.route) {
            return;
        }
    }

    msg.body = deCompose(msg);

    processMessage(pomelo, msg);
};

var onKick = function (data) {
    pomelo.emit('onKick');
};

handlers[Package.TYPE_HANDSHAKE] = handshake;
handlers[Package.TYPE_HEARTBEAT] = heartbeat;
handlers[Package.TYPE_DATA] = onData;
handlers[Package.TYPE_KICK] = onKick;

var processPackage = function (msg) {
    handlers[msg.type](msg.body);
};

var processMessage = function (pomelo, msg) {
    if (!msg || !msg.id) {
        // server push message
        // console.error('processMessage error!!!');
        pomelo.emit(msg.route, msg.body);
        return;
    }

    //if have a id then find the callback function with the request
    var cb = callbacks[msg.id];

    delete callbacks[msg.id];
    if (typeof cb !== 'function') {
        return;
    }

    cb(msg.body);
    return;
};

var processMessageBatch = function (pomelo, msgs) {
    for (var i = 0, l = msgs.length; i < l; i++) {
        processMessage(pomelo, msgs[i]);
    }
};

var deCompose = function (msg) {
    var protos = !!pomelo.data.protos ? pomelo.data.protos.server : {};
    var abbrs = pomelo.data.abbrs;
    var route = msg.route;

    try {
        //Decompose route from dict
        if (msg.compressRoute) {
            if (!abbrs[route]) {
                console.error('illegal msg!');
                return {};
            }

            route = msg.route = abbrs[route];
        }
        if (!!protos[route]) {
            return protobuf.decode(route, msg.body);
        } else {
            return JSON.parse(Protocol.strdecode(msg.body));
        }
    } catch (ex) {
        console.error('route, body = ' + route + ", " + msg.body);
    }

    return msg;
};

var handshakeInit = function (data) {
    if (data.sys && data.sys.heartbeat) {
        heartbeatInterval = data.sys.heartbeat * 1000;   // heartbeat interval
        heartbeatTimeout = heartbeatInterval * 2;        // max heartbeat timeout
    } else {
        heartbeatInterval = 0;
        heartbeatTimeout = 0;
    }

    initData(data);

    if (typeof handshakeCallback === 'function') {
        handshakeCallback(data.user);
    }
};

//Initilize data used in pomelo client
var initData = function (data) {
    if (!data || !data.sys) {
        return;
    }
    pomelo.data = pomelo.data || {};
    var dict = data.sys.dict;
    var protos = data.sys.protos;

    //Init compress dict
    if (!!dict) {
        pomelo.data.dict = dict;
        pomelo.data.abbrs = {};

        for (var route in dict) {
            pomelo.data.abbrs[dict[route]] = route;
        }
    }

    //Init protobuf protos
    if (!!protos) {
        pomelo.data.protos = {
            server: protos.server || {},
            client: protos.client || {}
        };
        if (!!protobuf) {
            protobuf.init({encoderProtos: protos.client, decoderProtos: protos.server});
        }
    }
};

/////////////////////////////////////////////////////////////

var queryHero = require(cwd + '/app/data/mysql').queryHero;
var genHero = require(cwd + '/app/data/mysql').genHero;
var envConfig = require(cwd + '/app/config/env.json');
var config = require(cwd + '/app/config/' + envConfig.env + '/config');
var mysql = require('mysql');

pomelo.player = null;
pomelo.uid = null;

var client = mysql.createConnection({
    "host": "127.0.0.1",
    "port": "3306",
    "database": "Pomelo",
    "user": "root",
    "password": "123456"
});

var START = 'start';
var END = 'end';
var DirectionNum = 8;

var EntityType = {
    PLAYER: 'player',
    NPC: 'npc',
    MOB: 'mob',
    EQUIPMENT: 'equipment',
    ITEM: 'item'
};

var ActFlagType = {
    ENTRY: 0,
    ENTER_SCENE: 1,
    ATTACK: 2,
    MOVE: 3,
    PICK_ITEM: 4
};

var monitor = function (type, name, reqId) {
    if (typeof actor !== 'undefined') {
        actor.emit(type, name, reqId);
    } else {
        console.error(Array.prototype.slice.call(arguments, 0));
    }
}

var connected = false;

// var offset = (typeof actor !== 'undefined') ? actor.id : 1;

// if (typeof actor !== 'undefined') {
//     console.log(offset + ' ' + actor.id);
// }


// temporary code
var limit = 1, offset = 10;
queryHero(client, limit, offset, function(error, users){
    // queryHero(client, 1, 0, function (error, users) {
    // temporary code
    console.log('QueryHero ~ offset = ', offset);
    var user = users[0];
    if (!user) {
        console.error('no-user-data');
        return;
    }
    client.end();
    // monitor(START, 'enterScene', ActFlagType.ENTER_SCENE);
    console.log('QueryHero is running ...');
    console.log('QueryHero ~ user = ', JSON.stringify(user));
    queryEntry(user.uid, function (host, port) {
        entry(host, port, user.token, function () {
            connected = true;
        });
    });
});

//var prefix = 'pomelo', max = 1000;
// genHero(client, prefix, max, function (err,users) {
//
// })


function queryEntry(uid, callback) {
    pomelo.init({host: '127.0.0.1', port: 3014, log: true}, function (err) {
        console.warn('init successed!!!!!!!');
        pomelo.request('gate.gateHandler.queryEntry', {uid: uid}, function (data) {
            console.log('QueryEntry is running ...');
            pomelo.disconnect();
            if (data.code === 2001) {
                console.log('Servers error!');
                return;
            }
            callback(data.host, data.port);
        });
    });
}

function entry(host, port, token, callback) {
    _host = host;
    _port = port;
    _token = token;
    if (!!socket) {
        return;
    }
    // 初始化socketClient
    pomelo.init({host: host, port: port, log: true}, function () {
        // monitor(START, 'entry', ActFlagType.ENTRY);
        pomelo.request('connector.entryHandler.entry', {token: token}, function (data) {
            // monitor(END, 'entry', ActFlagType.ENTRY);
            if (callback) {
                callback(data.code);
            }

            if (data.code == 1001) {
                console.log('Login fail!');
                return;
            } else if (data.code == 1003) {
                console.log('Username not exists!');
                return;
            }

            if (data.code != 200) {
                console.log('Login Fail!');
                return;
            }

            afterLogin(pomelo, data);
        });
    });
}

var afterLogin = function (pomelo, data) {
    pomelo.player = null;
    pomelo.players = {};
    pomelo.entities = {};
    pomelo.isDead = false;
    pomelo.lastAttack = null;
    var fightedMap = {};

    pomelo.on('onKick', function () {
        console.log('You have been kicked offline for the same account login in other place.');
    });

    pomelo.on('disconnect', function (reason) {
        console.log('disconnect invoke!' + reason);
    });

    var msgTempate = {scope: 'D41313', content: 'Kill ~'};
    /**
     * 处理登录请求
     */
    var login = function (data) {
        var player = data.player;
        if (player.id <= 0) {
            console.log("User is invalid! data = %j", data);
        } else {
            pomelo.uid = player.userId;
            pomelo.player = player;
            msgTempate.uid = pomelo.uid;
            msgTempate.playerId = pomelo.player.id;
            msgTempate.from = pomelo.player.name;
            msgTempate.areaId = pomelo.player.areaId;
            setTimeout(function () {
                enterScene();
            }, 0);
        }
    };

    login(data);

    var enterScene = function () {
        var msg = {uid: pomelo.uid, playerId: pomelo.player.id, areaId: pomelo.player.areaId};
        // monitor(START, 'enterScene', ActFlagType.ENTER_SCENE);
        pomelo.request("area.playerHandler.enterScene", msg, enterSceneRes);
        console.log('1 ~ EnterScene ~ areaId = %d, playerId = %d, name = %s',
            pomelo.player.areaId, pomelo.player.id, pomelo.player.name);
    }

    var enterSceneRes = function (data) {
        // monitor(END, 'enterScene', ActFlagType.ENTER_SCENE);
        pomelo.player = data.curPlayer;
        pomelo.addEntity(pomelo.player);

        for (var key in data.entities) {
            if (key !== EntityType.NPC) {
                var array = data.entities[key];
                for (var i = 0; i < array.length; i++) {
                    var entity = array[i];
                    entity.type = key;
                    pomelo.addEntity(entity);
                }
            }
        }

        /*
         var start = 0
         , end = 0;
         start = new Date().getTime();
         console.log('\n\n' + 'start = ', start);
         // create instance testing
         var cnt = 10;
         pomelo.request("area.playerHandler.createInstance", {cnt: cnt}, function(args) {
         end = new Date().getTime();
         console.log('end = ', end);
         console.log('CreateInstance ~ args = ', JSON.stringify(args));
         // 計算花多久時間
         var tmpStr = util.format('CreateInstance(cnt=%j) cost time : %j sec\n\n', cnt, (end - start)/1000)
         console.log(tmpStr);
         process.exit(0);
         });
         */

        var actRandom = Math.floor(Math.random() * 2 + 1);
        var intervalTime = Math.floor(Math.random() * 3000 + 2000);
        if (actRandom === 1) {
            setInterval(function () {
                moveEvent();
            }, intervalTime);
            console.log('2 ~ EnterSceneRes ~ areaId = %d, playerId = %d, mover = %s, intervalTime = %d',
                pomelo.player.areaId, pomelo.player.id, pomelo.player.name, intervalTime);
        } else {
            setInterval(function () {
                attackEvent();
            }, intervalTime);
            console.log('2 ~ EnterSceneRes ~ areaId = %d, playerId = %d, fighter = %s, intervalTime = %d',
                pomelo.player.areaId, pomelo.player.id, pomelo.player.name, intervalTime);
        }

        /*
         setInterval(function() {
         moveEvent();
         }, intervalTime);
         console.log('2 ~ EnterSceneRes ~ areaId = %d, playerId = %d, mover = %s, intervalTime = %d',
         pomelo.player.areaId, pomelo.player.id, pomelo.player.name, intervalTime);
         setInterval(function() {
         attackEvent();
         }, intervalTime);
         console.log('2 ~ EnterSceneRes ~ areaId = %d, playerId = %d, fighter = %s, intervalTime = %d',
         pomelo.player.areaId, pomelo.player.id, pomelo.player.name, intervalTime);
         */
    }

    var sendChat = function () {
        pomelo.request('chat.chatHandler.send', msgTempate, okRes);
    }

    /**
     * 处理用户离开请求
     */
    pomelo.removePlayer = function (playerId) {
        var entityId = this.players[playerId];
        if (!!entityId) {
            this.removeEntity(entityId);
        }
    };

    pomelo.on('onUserLeave', function (data) {
        var playerId = data.playerId;
        this.removePlayer(playerId);
    });

    /**
     * 处理用户攻击请求
     */
    pomelo.on('onAttack', function (data) {
        if (data.result.result === 2) {
            var attackId = parseInt(data.attacker);
            var targetId = parseInt(data.target);
            var selfId = parseInt(pomelo.player.entityId);
            if (attackId === selfId || targetId === selfId) {
                if (targetId !== selfId) {
                    clearAttack();
                    pomelo.isDead = false;
                    this.removeEntity(targetId);
                } else {
                    pomelo.isDead = true;
                    clearAttack();
                }
            } else {
                if (!!pomelo.lastAttAck && targetId === pomelo.lastAttAck.entityId) {
                    clearAttack();
                }
                this.removeEntity(targetId);
            }
        }
    });

    pomelo.on('onRevive', function (data) {
        if (data.entityId === pomelo.player.entityId) {
            pomelo.isDead = false;
            clearAttack();
        } else {
            this.addEntity(data.entity);
        }
    });

    pomelo.on('onUpgrade', function (data) {
        msgTempate.content = 'Upgrade to ' + data.player.level + '!';
        sendChat();
    });

    pomelo.on('onDropItems', function (data) {
        var items = data.dropItems;
        var length = items.length;
        for (var i = 0; i < length; i++) {
            this.addEntity(items[i]);
        }
    });

    pomelo.on('onMove', function (data) {
        // console.log("OnMove ~ data = %j", data);
        var entity = pomelo.entities[data.entityId];
        if (!entity) {
            return;
        }
        if (data.entityId === pomelo.player.entityId) {
            var path = data.path[1];
            pomelo.player.x = path.x;
            pomelo.player.y = path.y;
            // console.log('self %j move to x=%j, y=%j', pomelo.uid, path.x, path.y);
        }
    });

    var moveDirection = Math.floor(Math.random() * DirectionNum + 1);

    var getPath = function () {
        var FIX_SPACE = Math.floor(Math.random() * pomelo.player.walkSpeed + 1);
        var startX = pomelo.player.x;
        var startY = pomelo.player.y;
        var endX = startX;
        var endY = startY;
        moveDirection = (++moveDirection % DirectionNum) ? moveDirection : 1;
        switch (moveDirection) {
            case 1:
                endX += FIX_SPACE;
                break;
            case 2:
                endX += FIX_SPACE;
                endY += FIX_SPACE;
                break;
            case 3:
                endY += FIX_SPACE;
                break;
            case 4:
                endX -= FIX_SPACE;
                endY += FIX_SPACE;
                break;
            case 5:
                endX -= FIX_SPACE;
                break;
            case 6:
                endX -= FIX_SPACE;
                endY -= FIX_SPACE;
                break;
            case 7:
                endY -= FIX_SPACE;
                break;
            case DirectionNum:
            default:
                endX += FIX_SPACE;
                endY -= FIX_SPACE;
                break;
        }
        var path = [{x: startX, y: startY}, {x: endX, y: endY}];
        return path;
    }

    var getFirstFight = function () {
        var entities = pomelo.entities;
        var keyArray = Object.keys(entities);
        var len = keyArray.length;
        // console.log('entities.length = ', len);
        var randomNum = Math.floor(Math.random() * len);
        // console.log('randomNum = ', randomNum)
        var entity = entities[keyArray[randomNum]];
        // console.log('entity = ', entity)
        if (!entity) {
            for (var i = 0; i < entities.length; i++) {
                console.log('i = %j, entities[i] = %j', i, entities[i]);
            }
        }
        return entity;
    }

    var okRes = function () {

    }

    var moveEvent = function () {
        if (!!pomelo.isDead) {
            return;
        }
        var paths = getPath();
        var msg = {path: paths};
        monitor('incr', 'moveReq');
        monitor(START, 'move', ActFlagType.MOVE);
        pomelo.request('area.playerHandler.move', msg, function (data) {
            monitor(END, 'move', ActFlagType.MOVE);
            if (data.code !== RES_OK) {
                console.error('wrong path! %s %j : %d~%s, in area %d',
                    Date(), msg, pomelo.player.id, pomelo.player.name, pomelo.player.areaId);
                return;
            }
            pomelo.player.x = paths[1].x;
            pomelo.player.y = paths[1].y;

            if (!moveStat.idDict[pomelo.player.id]) {
                moveStat.idDict[pomelo.player.id] = true;
                moveStat.total++;
            }
            console.log('Total mover num = %j', moveStat.total);

            areaStat.idDict[pomelo.player.areaId] = areaStat.idDict[pomelo.player.areaId] || {};
            var tmpDict = areaStat.idDict[pomelo.player.areaId];
            if (!tmpDict[pomelo.player.id]) {
                tmpDict[pomelo.player.id] = true;
                tmpDict.total = tmpDict.total || 0;
                tmpDict.total++;
            }
            console.log('In area = %j, total mover num = %j\n', pomelo.player.areaId, tmpDict.total);

            console.log('%s : %d~%s is moving, in area %d, pos(%d, %d)',
                Date(), pomelo.player.id, pomelo.player.name,
                pomelo.player.areaId, pomelo.player.x, pomelo.player.y);
        });
    };

    var attackEvent = function () {
        if (!pomelo.player.entityId || !!pomelo.isDead) {
            return;
        }
        var entity = pomelo.lastAttAck;
        if (!!entity) {
            doAttack(entity);
            var count = fightedMap[entity.entityId] || 1;
            fightedMap[entity.entityId] = count + 1;
            if (count >= 10) {
                delete fightedMap[entity.entityId];
                clearAttack();
            }
        } else {
            doAttack(getFirstFight());
        }
    };

    var doAttack = function (entity) {
        if (!entity) {
            return;
        }
        if (entity.type === EntityType.MOB || entity.type === EntityType.PLAYER) {
            if (entity.died) {
                return;
            }
            pomelo.lastAttAck = entity;

            var attackId = entity.entityId;
            var route = 'area.fightHandler.attack';
            var msg = {targetId: attackId};
            monitor('incr', 'attackReq');
            monitor(START, 'attack', ActFlagType.ATTACK);
            // pomelo.notify(route, msg);
            pomelo.request(route, msg, function () {
                monitor(END, 'attack', ActFlagType.ATTACK);
                console.log('\nTotal attacker num = %j', attackStat.total);
            });

            if (!attackStat.idDict[pomelo.player.id]) {
                attackStat.idDict[pomelo.player.id] = true;
                attackStat.total++;
            }
            // console.log('\nTotal attacker num = %j', attackStat.total);

            areaStat.idDict[pomelo.player.areaId] = areaStat.idDict[pomelo.player.areaId] || {};
            var tmpDict = areaStat.idDict[pomelo.player.areaId];
            if (!tmpDict[pomelo.player.id]) {
                tmpDict[pomelo.player.id] = true;
                tmpDict.total = tmpDict.total || 0;
                tmpDict.total++;
            }
            console.log('In area = %j, total attacker num = %j\n', pomelo.player.areaId, tmpDict.total);

            console.log('%s : %d~%s attack %d, in area %d, pos(%d, %d)',
                Date(), pomelo.player.id, pomelo.player.name, entity.entityId,
                pomelo.player.areaId, pomelo.player.x, pomelo.player.y);
        } else if (entity.type === EntityType.ITEM || entity.type === EntityType.EQUIPMENT) {
            var route = 'area.playerHandler.pickItem';
            var attackId = entity.entityId;
            // var msg = { areaId:pomelo.player.areaId, playerId:pomelo.player.id, targetId:attackId};
            var msg = {areaId: pomelo.player.areaId, playerId: pomelo.player.id, targetId: attackId};
            monitor(START, 'pickItem', ActFlagType.PICK_ITEM);
            pomelo.request(route, msg, function () {
                monitor(END, 'pickItem', ActFlagType.PICK_ITEM);
            });
        }
    }

    pomelo.on('onPickItem', function (data) {
        clearAttack();
        this.removeEntity(data.item);
        var item = pomelo.entities[data.item];
        if (!!item && data.player === pomelo.player.entityId) {
            msgTempate.content = 'I got a ' + item.kindName;
            sendChat(msgTempate);
        }
        if (item) {
            delete item;
        }
    });

    pomelo.on('onRemoveItem', function (data) {
        clearAttack();
        delete pomelo.entities[data.entityId];
    });

    ///////////////////////////////////////////////////////////////////
    pomelo.on('onAddEntities', function (data) {
        var entities = data;
        for (var key in entities) {
            var array = entities[key];
            for (var i = 0; i < array.length; i++) {
                var entity = array[i];
                entity.type = key;
                this.addEntity(entity);
                /*
                 if(!this.getEntity(array[i].entityId)) {
                 var entity = array[i];
                 entity.type = key;
                 this.addEntity(entity);
                 }else{
                 console.warn('add exist entity!');
                 }
                 */
            }
        }
    });

    /**
     * Handle remove entities message
     * @param data {Object} The message, contains entitiy ids to remove
     */
    pomelo.on('onRemoveEntities', function (data) {
        var entities = data.entities;
        for (var i = 0; i < entities.length; i++) {
            if (entities[i] !== pomelo.player.entityId) {
                this.removeEntity(entities[i]);
            }
        }
    });

    pomelo.getEntity = function (id) {
        return this.entities[id];
    };

    pomelo.addEntity = function (entity) {
        if (!entity || !entity.entityId) {
            return false;
        }
        switch (entity.type) {
            case EntityType.PLAYER: {
                if (!!entity.id) {
                    pomelo.players[entity.id] = entity.entityId;
                    pomelo.entities[entity.entityId] = {
                        entityId: entity.entityId,
                        playerId: entity.id,
                        type: entity.type
                    };
                    return true;
                }
            }
                break;
            case EntityType.MOB:
            case EntityType.ITEM:
            case EntityType.EQUIPMENT: {
                pomelo.entities[entity.entityId] = {entityId: entity.entityId, type: entity.type};
                return true;
            }
                break;
        }
        return false;
    };

    /**
     * Remove entity from area
     * @param id {Number} The entity id or the entity to remove.
     * @api public
     */
    pomelo.removeEntity = function (id) {
        if (!pomelo.entities[id]) {
            return false;
        }

        delete pomelo.entities[id];
    };

    ////////////////////////////////////////////////////////////////////////

    var clearAttack = function () {
        pomelo.lastAttAck = null;
    }

};

