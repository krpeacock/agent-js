import { Buffer } from 'buffer/';
import { Actor } from './actor';
import { HttpAgent } from './agent';
import { Expiry, makeNonceTransform } from './agent/http/transforms';
import { CallRequest, SubmitRequestType, UnSigned } from './agent/http/types';
import * as cbor from './cbor';
import * as IDL from './idl';
import { Principal } from '@dfinity/principal';
import { requestIdOf } from './request_id';
import { blobFromHex, Nonce } from './types';

const originalDateNowFn = global.Date.now;
beforeEach(() => {
  global.Date.now = jest.fn(() => new Date(1000000).getTime());
});
afterEach(() => {
  global.Date.now = originalDateNowFn;
});

test.skip('makeActor', async () => {
  const actorInterface = () => {
    return IDL.Service({
      greet: IDL.Func([IDL.Text], [IDL.Text]),
    });
  };

  const expectedReplyArg = blobFromHex(IDL.encode([IDL.Text], ['Hello, World!']).toString('hex'));

  const mockFetch: jest.Mock = jest
    .fn()
    .mockImplementationOnce((/*resource, init*/) => {
      return Promise.resolve(
        new Response(null, {
          status: 202,
        }),
      );
    })
    .mockImplementationOnce((resource, init) => {
      const body = cbor.encode({ status: 'received' });
      return Promise.resolve(
        new Response(body, {
          status: 200,
        }),
      );
    })
    .mockImplementationOnce((resource, init) => {
      const body = cbor.encode({ status: 'processing' });
      return Promise.resolve(
        new Response(body, {
          status: 200,
        }),
      );
    })
    .mockImplementationOnce((resource, init) => {
      const body = cbor.encode({
        status: 'replied',
        reply: {
          arg: expectedReplyArg,
        },
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
        }),
      );
    });

  const methodName = 'greet';
  const argValue = 'Name';

  const arg = blobFromHex(IDL.encode([IDL.Text], [argValue]).toString('hex'));

  const canisterId = Principal.fromText('2chl6-4hpzw-vqaaa-aaaaa-c');
  const principal = await Principal.anonymous();
  const sender = principal.toUint8Array();

  const nonces = [
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]) as Nonce,
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) as Nonce,
    Buffer.from([2, 3, 4, 5, 6, 7, 8, 9]) as Nonce,
    Buffer.from([3, 4, 5, 6, 7, 8, 9, 0]) as Nonce,
    Buffer.from([4, 5, 6, 7, 8, 9, 0, 1]) as Nonce,
  ];

  const expectedCallRequest = {
    content: {
      request_type: SubmitRequestType.Call,
      canister_id: canisterId,
      method_name: methodName,
      arg,
      nonce: nonces[0],
      sender,
      ingress_expiry: new Expiry(300000),
    },
  } as UnSigned<CallRequest>;

  const expectedCallRequestId = await requestIdOf(expectedCallRequest.content);

  let nonceCount = 0;

  const httpAgent = new HttpAgent({ fetch: mockFetch });
  httpAgent.addTransform(makeNonceTransform(() => nonces[nonceCount++]));

  const actor = Actor.createActor(actorInterface, { canisterId, agent: httpAgent });
  const reply = await actor.greet(argValue);

  expect(reply).toEqual(IDL.decode([IDL.Text], expectedReplyArg)[0]);

  const { calls } = mockFetch.mock;

  expect(calls.length).toBe(5);
  expect(calls[0]).toEqual([
    `http://localhost/api/v2/canister/${canisterId.toText()}/call`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/cbor',
      },
      body: cbor.encode(expectedCallRequest),
    },
  ]);

  expect(calls[1]).toEqual([
    `http://localhost/api/v2/canister/${canisterId.toText()}/read_state`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/cbor',
      },
      body: cbor.encode({
        content: {
          request_type: 'request_status',
          request_id: expectedCallRequestId,
          ingress_expiry: new Expiry(300000),
        },
      }),
    },
  ]);

  expect(calls[2][0]).toBe('http://localhost/api/v1/read');
  expect(calls[2][1]).toEqual({
    method: 'POST',
    headers: {
      'Content-Type': 'application/cbor',
    },
    body: cbor.encode({
      content: {
        request_type: 'request_status',
        request_id: expectedCallRequestId,
        ingress_expiry: new Expiry(300000),
      },
    }),
  });

  expect(calls[3][0]).toBe('http://localhost/api/v1/read');
  expect(calls[3][1]).toEqual({
    method: 'POST',
    headers: {
      'Content-Type': 'application/cbor',
    },
    body: cbor.encode({
      content: {
        request_type: 'request_status',
        request_id: expectedCallRequestId,
        ingress_expiry: new Expiry(300000),
      },
    }),
  });

  expect(calls[4][0]).toBe('http://localhost/api/v1/read');
  expect(calls[4][1]).toEqual({
    method: 'POST',
    headers: {
      'Content-Type': 'application/cbor',
    },
    body: cbor.encode({
      content: {
        request_type: 'request_status',
        request_id: expectedCallRequestId,
        ingress_expiry: new Expiry(300000),
      },
    }),
  });
});

// TODO: tests for rejected, unknown time out
