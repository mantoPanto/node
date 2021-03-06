'use strict';

const common = require('../common');
const assert = require('assert');
const tick = require('./tick');
const initHooks = require('./init-hooks');
const fs = require('fs');
const { checkInvocations } = require('./hook-checks');

if (!common.hasCrypto) {
  common.skip('missing crypto');
  return;
}

const tls = require('tls');
const hooks = initHooks();
hooks.enable();

//
// Creating server and listening on port
//
const server = tls
  .createServer({
    cert: fs.readFileSync(common.fixturesDir + '/test_cert.pem'),
    key: fs.readFileSync(common.fixturesDir + '/test_key.pem')
  })
  .on('listening', common.mustCall(onlistening))
  .on('secureConnection', common.mustCall(onsecureConnection))
  .listen(common.PORT);

let svr, client;
function onlistening() {
  //
  // Creating client and connecting it to server
  //
  tls
    .connect(common.PORT, { rejectUnauthorized: false })
    .on('secureConnect', common.mustCall(onsecureConnect));

  const as = hooks.activitiesOfTypes('TLSWRAP');
  assert.strictEqual(as.length, 1, 'one TLSWRAP when client connecting');
  svr = as[0];

  assert.strictEqual(svr.type, 'TLSWRAP', 'tls wrap');
  assert.strictEqual(typeof svr.uid, 'number', 'uid is a number');
  assert.strictEqual(typeof svr.triggerId, 'number', 'triggerId is a number');
  checkInvocations(svr, { init: 1 }, 'server: when client connecting');
}

function onsecureConnection() {
  //
  // Server received client connection
  //
  const as = hooks.activitiesOfTypes('TLSWRAP');
  assert.strictEqual(as.length, 2,
                     'two TLSWRAPs when server has secure connection');
  client = as[1];
  assert.strictEqual(client.type, 'TLSWRAP', 'tls wrap');
  assert.strictEqual(typeof client.uid, 'number', 'uid is a number');
  assert.strictEqual(typeof client.triggerId, 'number',
                     'triggerId is a number');

  // TODO(thlorenz) which callback did the server wrap execute that already
  // finished as well?
  checkInvocations(svr, { init: 1, before: 1, after: 1 },
                   'server: when server has secure connection');

  checkInvocations(client, { init: 1, before: 2, after: 1 },
                   'client: when server has secure connection');
}

function onsecureConnect() {
  //
  // Client connected to server
  //
  checkInvocations(svr, { init: 1, before: 2, after: 1 },
                   'server: when client connected');
  checkInvocations(client, { init: 1, before: 2, after: 2 },
                   'client: when client connected');

  //
  // Destroying client socket
  //
  this.destroy();
  checkInvocations(svr, { init: 1, before: 2, after: 1 },
                   'server: when destroying client');
  checkInvocations(client, { init: 1, before: 2, after: 2 },
                   'client: when destroying client');

  tick(5, tick1);
  function tick1() {
    checkInvocations(svr, { init: 1, before: 2, after: 2 },
                     'server: when client destroyed');
    // TODO: why is client not destroyed here even after 5 ticks?
    // or could it be that it isn't actually destroyed until
    // the server is closed?
    checkInvocations(client, { init: 1, before: 3, after: 3 },
                     'client: when client destroyed');
    //
    // Closing server
    //
    server.close(common.mustCall(onserverClosed));
    // No changes to invocations until server actually closed below
    checkInvocations(svr, { init: 1, before: 2, after: 2 },
                     'server: when closing server');
    checkInvocations(client, { init: 1, before: 3, after: 3 },
                     'client: when closing server');
  }
}

function onserverClosed() {
  //
  // Server closed
  //
  tick(1E4, common.mustCall(() => {
    checkInvocations(svr, { init: 1, before: 2, after: 2 },
                     'server: when server closed');
    checkInvocations(client, { init: 1, before: 3, after: 3 },
                     'client: when server closed');
  }));
}

process.on('exit', onexit);

function onexit() {
  hooks.disable();
  hooks.sanityCheck('TLSWRAP');

  checkInvocations(svr, { init: 1, before: 2, after: 2 },
                   'server: when process exits');
  checkInvocations(client, { init: 1, before: 3, after: 3 },
                   'client: when process exits');
}
