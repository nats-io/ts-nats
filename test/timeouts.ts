/*
 * Copyright 2018 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import test from "ava";
import {Lock, wait} from "./helpers/latch";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {connect} from "../src/nats";
import {join} from 'path';
import {createInbox} from "../src/util";
import {ErrorCode} from "../src/error";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});


test('subscription timeouts', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let lock = new Lock();

    let sub = await nc.subscribe(createInbox(), (err) => {
        //@ts-ignore
        t.is(err.code, ErrorCode.SUB_TIMEOUT);
        let elapsed = Date.now() - start;
        t.true(elapsed >= 45 && elapsed <= 100);
        nc.close();
        lock.unlock();
    });
    let start = Date.now();
    sub.setTimeout(50);

    return lock.latch;
});


test('message cancels timeout', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    let sub = await nc.subscribe(subj, (err) => {
        if(err) {
            t.fail();
        }
    });
    sub.setTimeout(500);
    t.true(sub.hasTimeout());
    sub.cancelTimeout();
    await wait(500);
    t.false(sub.hasTimeout());
    nc.close();
});


test('cancel timeout', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    let sub = await nc.subscribe(subj, (err) => {
        if(err) {
            t.fail();
        }
    });
    sub.setTimeout(500);
    t.true(sub.hasTimeout());
    sub.cancelTimeout();
    await wait(500);
    t.false(sub.hasTimeout());
    nc.close();
});

test('message cancels subscription timeout', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    let count = 0;
    let sub = await nc.subscribe(subj, (err, msg) => {
        if(err) {
            t.fail();
        } else {
            count++;
        }
    });
    sub.setTimeout(50);
    t.true(sub.hasTimeout());
    nc.publish(subj);
    await wait(500);
    t.false(sub.hasTimeout());
    nc.close();
});

test('max message cancels subscription timeout', async (t) => {
    t.plan(3);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let lock = new Lock();
    let subj = createInbox();
    let count = 0;
    let sub = await nc.subscribe(subj, (err, msg) => {
        if(err) {
            t.fail();
        } else {
            count++;
            if(count === 2) {
                process.nextTick(() => {
                    t.false(sub.isCancelled());
                    nc.close();
                    lock.unlock();
                });
            }
        }
    }, {max: 2});
    sub.setTimeout(50);
    t.true(sub.hasTimeout());
    nc.publish(subj);
    nc.publish(subj);
    await wait(500);
    t.false(sub.hasTimeout());
    return lock.latch;
});


test('timeout if expected is not received', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let lock = new Lock();

    let subj = createInbox();
    let count = 0;
    let sub = await nc.subscribe(subj, (err) => {
        if(err) {
           t.is(err.code, ErrorCode.SUB_TIMEOUT);
           t.is(sub.getReceived(), 1);
           nc.close();
           lock.unlock();
        } else {
            count++;
        }
    });
    sub.unsubscribe(2);
    sub.setTimeout(50);
    nc.publish(subj);

    return lock.latch;
});


test('no timeout if unsubscribed', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let lock = new Lock();

    let subj = createInbox();
    let sub = await nc.subscribe(subj, () => {
        sub.unsubscribe();
    });
    sub.unsubscribe(10);
    sub.setTimeout(50);
    nc.publish(subj);
    await nc.flush();
    setTimeout(()=> {
        t.pass();
        lock.unlock();
    }, 100);

    await lock.latch;
});

test('timeout unsubscribes', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let lock = new Lock();

    let subj = createInbox();
    let count = 0;
    let sub = await nc.subscribe(subj, (err) => {
        if(err) {
            process.nextTick(() => {
                nc.publish(subj);
                nc.flush();
            });
        } else {
            count++;
        }
    });
    sub.setTimeout(50);

    setTimeout(()=> {
        t.is(count, 0);
        lock.unlock();
    }, 100);

    await lock.latch;
});