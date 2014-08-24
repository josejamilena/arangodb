/*jslint indent: 2, nomen: true, maxlen: 120, sloppy: true, vars: true, white: true, plusplus: true */
/*global require, exports, Graph, arguments, ArangoClusterComm, ArangoServerState, ArangoClusterInfo */

////////////////////////////////////////////////////////////////////////////////
/// @brief pregel worker functionality
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2010-2014 triagens GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is triAGENS GmbH, Cologne, Germany
///
/// @author Florian Bartels, Michael Hackstein, Guido Schwab
/// @author Copyright 2011-2014, triAGENS GmbH, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

var p = require("org/arangodb/profiler");

var internal = require("internal");
var _ = require("underscore");
var db = internal.db;
var arangodb = require("org/arangodb");
var pregel = require("org/arangodb/pregel");
var ERRORS = arangodb.errors;
var ArangoError = arangodb.ArangoError;
var tasks = require("org/arangodb/tasks");

var step = "step";
var stepContent = "stepContent";
var waitForAnswer = "waitForAnswer";
var active = "active";
var state = "state";
var error = "error";
var stateFinished = "finished";
var stateRunning = "running";
var stateError = "error";
var COUNTER = "counter";
var ERR = "error";
var CONDUCTOR = "conductor";
var ALGORITHM = "algorithm";
var MAP = "map";
var id;
var WORKERS = 8;
var QUEUESIZE = 10000;

var queryInsertDefaultEdge = "FOR v IN @@original "
  + "LET from = PARSE_IDENTIFIER(v._from) "
  + "LET to = PARSE_IDENTIFIER(v._to) ";

var queryInsertDefaultEdgeInsertPart = "INSERT {'_key' : v._key, 'deleted' : false, 'result' : {}, "
  + "'_from' : CONCAT(TRANSLATE(from.collection, @collectionMapping), "
  + "'/', from.key), "
  + "'_to' : CONCAT(TRANSLATE(to.collection, @collectionMapping), "
  + "'/', to.key)";

var queryInsertDefaultEdgeIntoPart = "} INTO  @@result";

var queryInsertDefaultVertex = "FOR v IN @@original INSERT {"
  + " '_key' : v._key, 'active' : true, 'deleted' : false, 'result' : {},"
  + " 'locationObject': { '_id': v._id, 'shard': @origShard }";

var queryInsertDefaultVertexIntoPart = "} INTO  @@result";


var queryActivateVertices = "FOR v IN @@work "
  + "FILTER v.toShard == @shard && v.step == @step "
  + "UPDATE PARSE_IDENTIFIER(v._toVertex).key WITH "
  + "{'active' : true} IN @@result";

var queryUpdateCounter = "LET oldCount = DOCUMENT(@@global, 'counter').count "
  + "UPDATE 'counter' WITH {count: oldCount - 1} IN @@global";

var queryMessageByShard = "FOR v IN @@message "
  + "FILTER v.toShard == @shardId "
  + "RETURN v";

var queryCountStillActiveVertices = "LET c = (FOR i in @@collection"
  + " FILTER i.active == true && i.deleted == false"
  + " RETURN 1) RETURN LENGTH(c)";

var getQueueName = function (executionNumber) {
  return "P_QUEUE_" + executionNumber;
};

var algorithmToString = function (algorithm) {
  return "var time = require('org/arangodb/profiler').stopWatch();"
    + "var executionNumber = params.executionNumber; "
    + "var step = params.step;"
    + "var vertexInfo = params.vertexInfo;"
    + "var pregel = require('org/arangodb/pregel');"
    + "var mapping = new pregel.Mapping(executionNumber);"
    + "var worker = pregel.Worker;"
    + "var vertex = new pregel.Vertex(mapping, vertexInfo);"
    + "var messages = new pregel.MessageQueue(executionNumber, vertexInfo, step);"
    + "var global = params.global;"
    + "global.step = step;"
    + "try {"
    + "  (" + algorithm + ")(vertex,messages,global);"
    + " require('org/arangodb/profiler').storeWatch('singleVertex', time);"
    + "  worker.vertexDone(executionNumber, vertex, global, mapping);"
    + "} catch (err) {"
    + "  worker.vertexDone(executionNumber, vertex, global, mapping, err);"
    + "}";
};

var algorithmForQueue = function (algorithm, executionNumber) {
  return "(function() {"
    + "var t1 = require('org/arangodb/profiler').stopWatch();"
    + "var executionNumber = " + executionNumber + ";"
    + "var pregel = require('org/arangodb/pregel');"
    + "var mapping = new pregel.Mapping(executionNumber);"
    + "var worker = pregel.Worker;"
    + "var storeAggregate = pregel.storeAggregate(executionNumber);"
    + "require('org/arangodb/profiler').storeWatch('contextSetup', t1);"
    + "return function(params) {"
    + "var t2 = require('org/arangodb/profiler').stopWatch();"
    + "var step = params.step;"
    + "var vertexInfo = params.vertexInfo;"
    + "var vertex = new pregel.Vertex(mapping, vertexInfo);"
    + "var messages = new pregel.MessageQueue(executionNumber, vertexInfo, step, storeAggregate);"
    + "var global = params.global;"
    + "global.step = step;"
    + "try {"
    + "  (" + algorithm + ")(vertex,messages,global);"
    + "  require('org/arangodb/profiler').storeWatch('singleVertex', t2);"
    + "  worker.vertexDone(executionNumber, vertex, global, mapping);"
    + "} catch (err) {"
    + "  worker.vertexDone(executionNumber, vertex, global, mapping, err);"
    + "}"
    + "}"
    + "}())";
};

var createTaskQueue = function (executionNumber, algorithm) {
  tasks.createNamedQueue({
    name: getQueueName(executionNumber),
    threads: WORKERS,
    size: QUEUESIZE,
    worker: algorithmForQueue(algorithm, executionNumber)
  });
};

var addTask = function (queue, stepNumber, vertex, globals, executionNumber) {
  tasks.addJob(
    queue,
    {
      executionNumber: executionNumber,
      step: stepNumber,
      vertexInfo : vertex,
      global: globals
    }
  );
};

var saveMapping = function(executionNumber, map) {
  map._key = "map";
  pregel.getGlobalCollection(executionNumber).save(map);
};

var loadMapping = function(executionNumber) {
  return pregel.getMap(executionNumber);
};

var getConductor = function(executionNumber) {
  return pregel.getGlobalCollection(executionNumber).document(CONDUCTOR).name;
};

var getError = function(executionNumber) {
  return pregel.getGlobalCollection(executionNumber).document(ERR).error;
};

var setup = function(executionNumber, options) {
  // create global collection
  pregel.createWorkerCollections(executionNumber);
  p.setup();
  var global = pregel.getGlobalCollection(executionNumber);
  global.save({_key: COUNTER, count: -1});
  global.save({_key: ERR, error: undefined});
  global.save({_key: CONDUCTOR, name: options.conductor});
//  global.save({_key: ALGORITHM, algorithm : options.algorithm});
  if (options.aggregator) {
    pregel.saveAggregator(executionNumber, options.aggregator); 
  }
  saveMapping(executionNumber, options.map);
  createTaskQueue(executionNumber, options.algorithm);
  var map = options.map.map;
  var collectionMapping = {};

  var shardKeysAmount = 0;
  _.each(map, function(mapping, collection) {
    collectionMapping[collection] = mapping.resultCollection;
    if (shardKeysAmount < mapping.shardKeys.length) {
      shardKeysAmount = mapping.shardKeys.length;
    }
  });

  _.each(map, function(mapping) {
    var shards = Object.keys(mapping.originalShards);
    var resultShards = Object.keys(mapping.resultShards);
    var i;
    var bindVars;
    var iterator;
    for (i = 0; i < shards.length; i++) {
      if (mapping.originalShards[shards[i]] === pregel.getServerName()) {
        bindVars = {
          '@original' : shards[i],
          '@result' : resultShards[i]
        };
        if (mapping.type === 3) {
          bindVars.collectionMapping = collectionMapping;
          for (iterator = 0; iterator < shardKeysAmount; iterator++) {
            queryInsertDefaultEdgeInsertPart += ", 'shard_" + iterator + "' : v.shard_" + iterator;
            queryInsertDefaultEdgeInsertPart += ", 'to_shard_" + iterator + "' : v.to_shard_" + iterator;
          }
          db._query(
            queryInsertDefaultEdge + queryInsertDefaultEdgeInsertPart + queryInsertDefaultEdgeIntoPart, bindVars
          ).execute();
        } else {
          var shardKeyMap = "", count = 0;
          mapping.shardKeys.forEach(function (sk) {
            shardKeyMap += ", shard_" + count + " : v." + sk;
            count++;
          });
          bindVars.origShard = shards[i];
          db._query(
            queryInsertDefaultVertex + shardKeyMap + queryInsertDefaultVertexIntoPart, bindVars
          ).execute();
        }
      }
    }
  });
};


var activateVertices = function(executionNumber, step, mapping) {
  var t = p.stopWatch();
  var work = pregel.genWorkCollectionName(executionNumber);
  var resultShardMapping = mapping.getLocalResultShardMapping();
  _.each(resultShardMapping, function (resultShards, collection) {
    var originalShards = mapping.getLocalCollectionShards(collection);
    var i;
    var bindVars;
    for (i = 0; i < resultShards.length; i++) {
      bindVars = {
        '@work': work,
        '@result': resultShards[i],
        'shard': originalShards[i],
        'step': step
      };
      db._query(queryActivateVertices, bindVars).execute();
    }
  });
  p.storeWatch("ActivateVertices", t);
};

///////////////////////////////////////////////////////////
/// @brief Creates a cursor containing all active vertices
///////////////////////////////////////////////////////////
var getActiveVerticesQuery = function (mapping) {
  var count = 0;
  var bindVars = {};
  var query = "FOR u in UNION([], []";
  var resultShardMapping = mapping.getLocalResultShardMapping();
  _.each(resultShardMapping, function (resultShards) {
    var i;
    for (i = 0; i < resultShards.length; i++) {
      query += ",(FOR i in @@collection" + count
        + " FILTER i.active == true && i.deleted == false"
        + " RETURN {_id: i._id, shard: @collection" + count 
        + ", locationObject: i.locationObject, _doc: i})";
      bindVars["@collection" + count] = resultShards[i];
      bindVars["collection" + count] = resultShards[i];
    }
    count++;
  });
  query += ") RETURN u";
  return db._query(query, bindVars);
};

var countActiveVertices = function (mapping) {
  var count = 0;
  var bindVars = {};
  var resultShardMapping = mapping.getLocalResultShardMapping();
  _.each(resultShardMapping, function (resultShards) {
    var i;
    for (i = 0; i < resultShards.length; i++) {
      bindVars["@collection"] = resultShards[i];
      count += db._query(queryCountStillActiveVertices, bindVars).next();
    }
  });
  return count;
};

var sendMessages = function (executionNumber, mapping) {
  var msgCol = pregel.getMsgCollection(executionNumber);
  var workCol = pregel.getWorkCollection(executionNumber);
  if (ArangoServerState.role() === "PRIMARY") {
    var waitCounter = 0;
    var shardList = mapping.getGlobalCollectionShards();
    var batchSize = 100;
    var bindVars = {
      "@message": msgCol.name()
    };
    var coordOptions = {
      coordTransactionID: ArangoClusterInfo.uniqid()
    };
    _.each(shardList, function (shard) {
      bindVars.shardId = shard;
      var q = db._query(queryMessageByShard, bindVars);
      var toSend;
      while (q.hasNext()) {
        toSend = JSON.stringify(q.next(batchSize));
        waitCounter++;
        ArangoClusterComm.asyncRequest("POST","shard:" + shard, db._name(),
          "/_api/import?type=array&collection=" + workCol.name(), toSend, {}, coordOptions);
      }
    });
    var debug;
    for (waitCounter; waitCounter > 0; waitCounter--) {
      debug = ArangoClusterComm.wait(coordOptions);
    }
  } else {
    var cursor = msgCol.all();
    var next;
    while(cursor.hasNext()) {
      next = cursor.next();
      workCol.save(next);
    }
  }
  msgCol.truncate();
};

var finishedStep = function (executionNumber, global, mapping) {
  var t = p.stopWatch();
  var messages = pregel.getMsgCollection(executionNumber).count();
  var active = countActiveVertices(mapping);
  var error = getError(executionNumber);
  if (!error) {
    var t2 = p.stopWatch();
    sendMessages(executionNumber, mapping);
    p.storeWatch("ShiftMessages", t2);
  }
  if (ArangoServerState.role() === "PRIMARY") {
    var conductor = getConductor(executionNumber);
    var body = JSON.stringify({
      server: pregel.getServerName(),
      step: global.step,
      executionNumber: executionNumber,
      messages: messages,
      active: active,
      error: error
    });
    var coordOptions = {
      coordTransactionID: ArangoClusterInfo.uniqid()
    };
    ArangoClusterComm.asyncRequest("POST","server:" + conductor, db._name(),
      "/_api/pregel/finishedStep", body, {}, coordOptions);
    var debug = ArangoClusterComm.wait(coordOptions);

  } else {
    p.storeWatch("FinishStep", t);
    pregel.Conductor.finishedStep(executionNumber, pregel.getServerName(), {
      step: global.step,
      messages: messages,
      active: active,
      error: error
    });
  }
};

var vertexDone = function (executionNumber, vertex, global, mapping, err) {
  var t = p.stopWatch();
  vertex._save();
  if (err && err instanceof ArangoError === false) {
    var error = new ArangoError();
    error.errorNum = ERRORS.ERROR_PREGEL_ALGORITHM_SYNTAX_ERROR.code;
    error.errorMessage = ERRORS.ERROR_PREGEL_ALGORITHM_SYNTAX_ERROR.message + ": " + err;
    err = error;
  }
  var globalCol = pregel.getGlobalCollection(executionNumber);
  if (err && !getError(executionNumber)) {
    globalCol.update(ERR, {error: err});
  }
  var performFinish = db._executeTransaction({
    collections : {write : [globalCol.name()]},
    action : function (params) {
      var db = internal.db;
      globalCol = params.globalCol;
      db._query(params.queryUpdateCounter, {"@global": globalCol.name()});
      var counter = globalCol.document(params.counter).count;
      if (counter === 0) {
        return true;
      }
      return false;
    },
    params : {
      globalCol : globalCol,
      worker : this,
      queryUpdateCounter : queryUpdateCounter,
      counter : COUNTER

    }
  });
  p.storeWatch("VertexDone", t);
  if (performFinish === true) {
    finishedStep(executionNumber, global, mapping);
  }
};

var executeStep = function(executionNumber, step, options, globals) {
  id = ArangoServerState.id() || "localhost";
  if (step === 0) {
    setup(executionNumber, options);
  }
  var mapping = new pregel.Mapping(executionNumber);
  activateVertices(executionNumber, step, mapping);
  var q = getActiveVerticesQuery(mapping);
  // read full count from result and write to work
  var col = pregel.getGlobalCollection(executionNumber);
  col.update(COUNTER, {count: q.count()});
  if (q.count() === 0) {
    finishedStep(executionNumber, {step : step}, mapping);
  } else {
    var t = p.stopWatch();
    var n;
    globals = globals || {};
    var queue = getQueueName(executionNumber);
    while (q.hasNext()) {
      n = q.next();
      addTask(queue, step, n, globals);
    }
    p.storeWatch("AddingAllTasks", t);
  }
};

var cleanUp = function(executionNumber) {
  // queues.delete("P_" + executionNumber); To be done for new queue
  db._drop(pregel.genWorkCollectionName(executionNumber));
  db._drop(pregel.genMsgCollectionName(executionNumber));
  db._drop(pregel.genGlobalCollectionName(executionNumber));
};


// -----------------------------------------------------------------------------
// --SECTION--                                                    MODULE EXPORTS
// -----------------------------------------------------------------------------

// Public functions
exports.executeStep = executeStep;
exports.cleanUp = cleanUp;
exports.finishedStep = finishedStep;
exports.vertexDone = vertexDone;
