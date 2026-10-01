import test from 'node:test';
import assert from 'node:assert/strict';
import { findPostal, findStreet, splitTitle } from '../api/_lib/address.js';

test('postal codes are found however reps write them', () => {
  for (const text of ['550123', 'S550123', 'S(550123)', 'Singapore 550123', 'Blk 123, #05-12, 550123']) {
    assert.equal(findPostal(text)?.code, '550123', text);
  }
});

test('phone numbers, unit numbers and short numbers are not postal codes', () => {
  for (const text of ['Call 91234567', '#05-12', 'Blk 123', 'Ref 1234567', '']) {
    assert.equal(findPostal(text), null, text);
  }
});

test('street addresses are spelled out in full for the lookup', () => {
  const cases = [
    ['Blk 123 Serangoon Ave 3', '123 Serangoon Avenue 3', '123'],
    ['1 Sireh Place', '1 Sireh Place', '1'],
    ['Blk 456 Jurong West St 42', '456 Jurong West Street 42', '456'],
    ['21 Lower Kent Ridge Rd', '21 Lower Kent Ridge Road', '21'],
    ['12 Pasir Ris Dr 3', '12 Pasir Ris Drive 3', '12'],
    ['10 Hill Street', '10 Hill Street', '10'],
    ['7 Jln Bukit Merah', '7 Jalan Bukit Merah', '7'],
    ['123A Lor 1 Toa Payoh', '123A Lorong 1 Toa Payoh', '123A'],
  ];
  for (const [text, query, blk] of cases) {
    const s = findStreet(text);
    assert.equal(s?.query, query, text);
    assert.equal(s?.blk, blk, text);
  }
});

test('ordinary words and times are not mistaken for streets', () => {
  for (const text of ['Mr Tan 2nd visit', 'Meet at 3 pm', 'Roof check', 'Mr Lim - roof check']) {
    assert.equal(findStreet(text), null, text);
  }
});

test("a title is split into the client's name and the address in it", () => {
  const cases = [
    ['Site visit – Mr Tan, Blk 123 Serangoon Ave 3, 550123', 'Mr Tan', 'Blk 123 Serangoon Ave 3, 550123'],
    ['Mr Tan 550123', 'Mr Tan', '550123'],
    ['Mdm Lee S550123', 'Mdm Lee', 'S550123'],
    ['Mdm Lee S(550123)', 'Mdm Lee', 'S(550123)'],
    ['Mr Tan Singapore 550123', 'Mr Tan', 'Singapore 550123'],
    ['Site visit @ 123 Serangoon Ave 3 (Mr Tan)', 'Mr Tan', '123 Serangoon Ave 3'],
    ['Site visit at 123 Serangoon Ave 3 (Mr Tan)', 'Mr Tan', '123 Serangoon Ave 3'],
    ['Site visit – Mr Tan – 123 Serangoon Ave 3', 'Mr Tan', '123 Serangoon Ave 3'],
    ['Mr Tan at 1 Sireh Place', 'Mr Tan', '1 Sireh Place'],
    ['Mdm Koh – 12 Pasir Ris Dr 3, #05-12', 'Mdm Koh', '12 Pasir Ris Dr 3, #05-12'],
    ['Mr Goh, Blk 456 Jurong West St 42', 'Mr Goh', 'Blk 456 Jurong West St 42'],
  ];
  for (const [title, name, address] of cases) {
    const r = splitTitle(title);
    assert.equal(r.name, name, `name from "${title}"`);
    assert.equal(r.address, address, `address from "${title}"`);
  }
});

test('titles without an address are left exactly as the name', () => {
  for (const [title, name] of [
    ['Site visit – Tan, Ah Kow', 'Tan, Ah Kow'],
    ['Mr Lim - roof check', 'Mr Lim - roof check'],
    ['Call Mr Tan 91234567', 'Call Mr Tan 91234567'],
    ['Site visit', 'Site visit'],
    ['', 'Site visit'],
  ]) {
    const r = splitTitle(title);
    assert.equal(r.name, name, title);
    assert.equal(r.address, '', title);
  }
});
