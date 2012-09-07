var pomelo = {};

pomelo.player = null;
pomelo.players = {};
pomelo.entities = {};
pomelo.isDead = false;
pomelo.attackId = 0;
pomelo.bags = [];
pomelo.equipments = [];
pomelo.areas = [];
pomelo.skills = [];


var msgTempate = {route:'chat.chatHandler.send',scope:'D41313',content:'老子要杀怪了'};

var login = function(){
  //console.log('%j',Iuser);
  var data = {route:'connector.loginHandler.login', username:Iuser.username, password:Iuser.passwd};
  robot.request(data,loginRes,true);
};

/**
 * 处理登录请求
 */
var loginRes = function(data){
		//console.log('longined %j',data);
			var user = data.user;
			var player = data.player;
    if (player.id <= 0) { 
			console.log("用户不存在\n uid:" + uid + " code:" + data.code);
    } else {
			pomelo.uid = user.id;
			pomelo.player = player;
			var msg = {route:"area.playerHandler.enterScene", uid:pomelo.uid, playerId: pomelo.player.id, areaId: pomelo.player.areaId};
			robot.request(msg,enterScene,false);
			msgTempate.uid = pomelo.uid;
			msgTempate.playerId = pomelo.player.id;
			msgTempate.from = pomelo.player.name,
			msgTempate.areaId = pomelo.player.areaId;
    }
};

login();

var enterScene = function(data) {
  var area = data.data.area;
  pomelo.areas[area.id] = area;
  pomelo.entities = data.data.area.entities;
  pomelo.player = data.data.curPlayer;
  pomelo.entities[pomelo.player.entityId] = pomelo.player;
	var moveRandom = Math.floor(Math.random()*3+1);
  if (moveRandom<=2) {
      robot.interval(moveEvent,2000+Math.round(Math.random()*3000));
      console.log(' mover:' + pomelo.player.name);
  } else { 
      robot.interval(attackEvent,2000+Math.round(Math.random()*3000));
      console.log('fighter:' + pomelo.player.name);
    }
}


var sendChat = function() {
  msgTempate.content = '捡到一个XXOO的玩意';
  robot.request(msgTempate);
}

/**
 * 处理用户离开请求
 */
robot.on('onUserLeave',function(data){
    //console.log("用户离开: " + JSON.stringify(data));
    var player = pomelo.players[data.playerId];
    if (!!player) {
    //console.log(' user leave %j ',player);
    clearAttack(player.entityId);
    delete pomelo.entities[player.entityId]
    delete player;
    }
});


robot.on('addEntities', function(data){
    var entities = data.entities;
    for(var i = 0; i < entities.length; i++){
      var entity = entities[i];
      //console.log(pomelo.player.entityId + ' self data   ' + entity.entityId);
      //console.log('entity %j',entity); 
      pomelo.entities[entity.entityId] = entity;
      if (entity.type==='player' && entity.id===pomelo.player.id) {
        pomelo.player.x = entity.x;
        pomelo.player.y = entity.y;
      }
    }
});

/**
 * Handle remove entities message
 * @param data {Object} The message, contains entitiy ids to remove
 */
robot.on('removeEntities', function(data){
    var entities = data.entities;
    for(var i = 0; i < entities.length; i++){
      var entityId = entities[i];
       delete pomelo.entities[entityId];
    }
});


/**
 * 处理用户攻击请求
 */
robot.on('onAttack',function(data){
    //console.log("fighting: " + JSON.stringify(data));
    if (data.result.result === 2) {
    //console.log("fighting: " + JSON.stringify(data));
    var attackId = parseInt(data.attacker);
    var targetId = parseInt(data.target);
    var selfId = parseInt(pomelo.player.entityId);
    if (attackId === selfId || targetId === selfId) {
    if (targetId !== selfId){
    pomelo.attackId = 0;
    pomelo.isDead = false;
    //console.error(' oh fuck done by self ' + pomelo.uid + ' ' + targetId);
    delete pomelo.entities[targetId];
    }
    if (targetId === selfId) {
    pomelo.isDead = true;
    pomelo.attackId = 0;
    //console.error('oh,my god,self died %j %j',pomelo.player.playerId,pomelo.uid);
    }
    } else {
    if (targetId === pomelo.attackId) {
      pomelo.attackId = 0;
      //console.error(' oh fuck by other ' + pomelo.uid + ' ' + targetId);
    }
    delete pomelo.entities[targetId];
    }
    }
});


robot.on('onRevive', function(data){
    if (data.entityId === pomelo.player.entityId) {
    pomelo.isDead = false;
    pomelo.attackId = 0;
    //console.log(' ON revive %j',pomelo.player.id + ' ' + pomelo.uid);
    }
});


robot.on('onUpgrade' , function(data){
      if (data.player.id===pomelo.player.id)
      {   msgTempate.content = 'NB的我升'+data.player.level+'级了，羡慕我吧';
      pomelo.level = data.player.level;    
      //robot.request(msgTempate);
      }
});


robot.on('onDropItems' , function(data) {
    var items = data.dropItems;
    for (var i = 0; i < items.length; i ++) {
    var item = items[i];
    pomelo.entities[item.entityId] = item;
    }
});

/*
 *
 */

robot.on('onAddMob', function(data){
    //console.log('on addMob %j',data);
    var mob = data.mob;
    var slim = new SlimPlay(mob.id||0,mob.entityId,mob.name||'mob',mob.level);
    pomelo.entities[mob.entityId] = slim; 
    //area.addEntity(mob);
    data = null;
});



robot.on('onMove',function(data){
    var entity = pomelo.entities[data.entityId];
    if (!entity) {return;}
    if (data.entityId ===pomelo.player.entityId) {
      var path = data.path[1];
      pomelo.player.x = path.x;
      pomelo.player.y = path.y;
    }
    pomelo.entities[data.entityId] = entity;    
});

var getEntityLength =function (entities) {
  var count=0;
  for (var id in entities) {
    var entity = pomelo.entities[id];
    if (entity.type==='npc' || entity.type==='player') continue;
    if (entity.entityId === pomelo.player.entityId) {continue;}
    count++;
  }
  return count;
};

var moveDirection = 1+Math.floor(Math.random()*7);


/**
 * 处理用户移动请求
 */
robot.on('area.playerHandler.move',function(data){
	if (data.code !=200) {
    moveDirection++;
    //console.error('rong way ' + moveDirection +  ' ' + pomelo.player.name);
    return;
  }
  
  if (moveDirection>=8){ moveDirection = 1+Math.floor(Math.random()*5);}

});

var FIX_SPACE = 120;

var getPath = function() {
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
      endX+=FIX_SPACE;
      endY-=FIX_SPACE;
      break;
  }
  var path = [{x: startX, y: startY}, {x:endX, y:endY}];
  return path;
}

var getFirstFight = function() {
  var nearstId = 0,nearEntity = null,count=0,size =  getEntityLength(pomelo.entities); 
  var randomNum = Math.floor(Math.random()*size);
  for (var id in pomelo.entities){
    var entity = pomelo.entities[id];
    if (entity.type==='npc' || entity.type==='player') {continue;}
    if (entity.entityId === pomelo.player.entityId) {continue;}
    //if (entity.type==='mob' && entity.level>pomelo.level) {continue;}
    if (count>=randomNum) {
      nearstId = id;
      nearEntity = entity ;
      break;
    } 
    count++;
  }
  if (nearstId<=0) {return;}
  pomelo.lastAttAckId = nearstId;
  console.log(' first fight uid=%j type=%j attackId=%j' ,pomelo.uid ,nearEntity.type,nearstId);
  return nearEntity;
}

var moveEvent = function() {

  if (!!pomelo.isDead) {return;}

 var msg = {route: 'area.playerHandler.move', path:getPath()};
      robot.request(msg);


}

var fightedMap = {};

var attackEvent = function(){
  //console.log(pomelo.isDead + ' ' + pomelo.uid + ' ' + pomelo.player.entityId + ' ' + pomelo.attackId);
  if (!pomelo.player.entityId || !!pomelo.isDead ) {
    return;
  }
  if (pomelo.attackId>0) {
    var entity = pomelo.entities[pomelo.attackId];
    if (!!entity) {
      attack(entity);
      var count = fightedMap[pomelo.attackId] ||1;
      fightedMap[pomelo.attackId] = (count+1);
      if (count>=10) {
        delete fightedMap[pomelo.attackId];
        delete entity;
        clearAttack(pomelo.attackId);
      }
    } else {
      clearAttack(pomelo.attackId);
    }
  } else {
    var fightEntity = getFirstFight();
    attack(fightEntity);
  }
};

pomelo.lastAttAckId = 0;

attack = function(entity) {
  if (!entity) {return;}
  //console.log(pomelo.isDead + ' ' + pomelo.uid + ' ' + pomelo.playerId + ' ' + entity.entityId + ' ' + entity.type);
  if (entity.type === 'player' || entity.type === 'mob') {
    if (entity.died) {return;}
    var attackId = entity.entityId;
    pomelo.attackId = attackId;
    var skillId = 1;
    var route = 'area.fightHandler.attack';
    var areaId = pomelo.player.areaId;
    var msg = {route:route,areaId:areaId,playerId: pomelo.player.id, targetId:attackId, skillId: skillId};
    robot.request(msg);
    //console.log(' begin attack == %j , %j ',entity.type,msg); 
  } else if (entity.type === 'npc') {
    //
  } else if (entity.type === 'item' || entity.type === 'equipment') {
    var route = 'area.playerHandler.pickItem';
    var attackId = entity.entityId;
    var msg = {route:route, areaId:pomelo.player.areaId, playerId:pomelo.player.id, targetId:attackId};
    //console.log(' begin pickup == %j , %j ',entity.type,msg); 
    robot.request(msg);
  }
}

/*
 *ITEM ACTION
 *
 */
robot.on('onPickItem', function(data){
    clearAttack(data.item);
    var item = pomelo.entities[data.item];
    //console.log('pic %j',data);
    if (!!item && data.player===pomelo.player.entityId) {
    msgTempate.content = '捡到一个XXOO的'+ item.kindName+'玩意';
    //robot.request(msgTempate);
    }
    delete item;
    });

robot.on('onRemoveItem', function(data){
    clearAttack(data.entityId);
    delete pomelo.entities[data.entityId];
    });

clearAttack = function(entityId){
  if (entityId===pomelo.attackId) {
    pomelo.attackId = 0;
  }
}
