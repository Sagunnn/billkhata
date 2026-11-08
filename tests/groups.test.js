import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGroup, groupId, groupMembersFrom, peekPendingGroup, removeGroup, setPendingGroup, splitMembersFromGroup, tripMembersFromGroup, upsertGroup } from '../src/lib/groups.js';
import { computeSplit, makeMember } from '../src/lib/splitter.js';
import { getDefaultAssignedMembers, hereMembers, makeTrip, makeTripMember, quickTripEntry } from '../src/lib/trips.js';

const office = { name: 'Office lunch', members: [{ name: 'Hari', diet: 'non-veg', alcohol: true }, { name: 'Sita', diet: 'veg' }, { name: 'hari ' }, { name: '' }] };

test('a group is tidied: one per name, no blanks, an id from its name', () => {
  const g = cleanGroup(office);
  assert.deepEqual(g.members.map((m) => m.name), ['Hari', 'Sita']);
  assert.equal(g.members[1].alcohol, false);
  assert.equal(g.id, 'g-office-lunch');
  assert.equal(cleanGroup({ name: '  ', members: [] }), null);
  assert.equal(groupId({ name: 'साथीहरू' }), 'g-साथीहरू');
});

test('making, renaming and deleting groups', () => {
  const at = new Date('2026-11-08T10:00:00Z');
  let list = upsertGroup([], office, at);
  assert.equal(list.length, 1);
  const id = list[0].id;
  assert.match(id, /^g-office-lunch-/);
  assert.throws(() => upsertGroup(list, { name: 'office LUNCH', members: [{ name: 'Ram' }] }), /already have a group/);
  assert.throws(() => upsertGroup(list, { name: 'Trek', members: [] }), /at least one person/);
  assert.throws(() => upsertGroup(list, { name: ' ', members: [{ name: 'Ram' }] }), /name/);
  list = upsertGroup(list, { id, name: 'Lunch crew', members: [{ name: 'Hari' }] });
  assert.deepEqual(list.map((g) => [g.id, g.name, g.members.length]), [[id, 'Lunch crew', 1]]);
  assert.deepEqual(removeGroup(list, id), []);
});

test('a split from a group: everyone in, the ones not here pay nothing', () => {
  const g = cleanGroup(office);
  const me = makeMember({ name: 'Ram', isPayer: true, id: 'me' });
  const people = [me, ...splitMembersFromGroup(g, { existing: [me], notHere: ['sita'] })];
  assert.deepEqual(people.map((m) => [m.name, m.out]), [['Ram', false], ['Hari', false], ['Sita', true]]);
  const r = computeSplit({ total: 600, mode: 'equal', items: [], members: people, overrides: {} });
  assert.deepEqual(r.members.map((m) => m.share), [300, 300, 0]);
  // Adding the group again adds nobody twice.
  assert.equal(splitMembersFromGroup(g, { existing: people }).length, 0);
  // A split's people saved as a group: without the payer.
  assert.deepEqual(groupMembersFrom(people).map((m) => m.name), ['Hari', 'Sita']);
});

test('a trip from a group: only the ones coming, veg and drinks carried over', () => {
  const g = cleanGroup(office);
  const trip = makeTrip({ name: 'Nagarkot', profile: { fullName: 'Ram Bahadur' } });
  const add = tripMembersFromGroup(g, { existing: trip.members, coming: new Set(['Sita']) });
  assert.deepEqual(add.map((m) => [m.name, m.isVeg, m.drinks]), [['Sita', true, false]]);
  assert.equal(tripMembersFromGroup(g, { existing: [{ name: 'hari' }] }).length, 1);
});

test('trip people marked Not here are left out of new expenses', () => {
  const members = [makeTripMember({ id: 'me', name: 'Ram', isMe: true }), makeTripMember({ id: 'h', name: 'Hari' }), makeTripMember({ id: 's', name: 'Sita', isVeg: true, away: true })];
  assert.deepEqual(hereMembers(members).map((m) => m.id), ['me', 'h']);
  assert.deepEqual(getDefaultAssignedMembers('shared', members), ['me', 'h']);
  assert.deepEqual(quickTripEntry({ title: 'Taxi', amount: 900, paidByMemberId: 'me' }, members).items[0].assignedMemberIds, ['me', 'h']);
  // Nobody here at all: everyone, rather than nobody.
  assert.equal(hereMembers(members.map((m) => ({ ...m, away: true }))).length, 3);
});

test('"Split a bill" with a group is remembered for half an hour', () => {
  const box = new Map();
  const store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v), removeItem: (k) => box.delete(k) };
  setPendingGroup(cleanGroup(office), store);
  assert.equal(peekPendingGroup(store)?.name, 'Office lunch');
  assert.equal(peekPendingGroup(store, Date.now() + 31 * 60e3), null);
});

test('a face (gender and look) goes with a person from a group into a split or trip', () => {
  const g = cleanGroup({ name: 'Trek', members: [{ name: 'Sita', diet: 'veg', gender: 'f', look: 3 }, { name: 'Hari', gender: 'x' }] });
  assert.deepEqual(g.members.map((m) => [m.gender, m.look]), [['f', 3], [undefined, undefined]]);
  const [sita] = splitMembersFromGroup(g);
  assert.deepEqual([sita.gender, sita.look], ['f', 3]);
  const [s2] = tripMembersFromGroup(g);
  assert.deepEqual([s2.gender, s2.look, s2.isVeg], ['f', 3, true]);
  assert.deepEqual(groupMembersFrom([sita]).map((m) => [m.gender, m.look]), [['f', 3]]);
});
