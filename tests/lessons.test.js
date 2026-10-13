"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Lessons = require('../lessons');
test('both lesson animations finish within five seconds', () => {
  assert.deepEqual(Lessons.lessons.map(x => x.name), ['Chicken Wing', 'Wash Hands']);
  for (const lesson of Lessons.lessons) {
    assert.ok(lesson.duration <= 5);
    assert.ok(Lessons.frame(lesson.id, 5).done);
    assert.ok(fs.statSync(lesson.image).size > 0);
    assert.ok(fs.statSync(`audio/${lesson.id}.mp3`).size > 0);
  }
});
test('the bent arm reaches the mouth before coughing and returns to rest', () => {
  const pose = Lessons.frame('chicken-wing', 2);
  assert.equal(pose.cough, true);
  const upper = pose.upper * Math.PI / 180;
  const forearm = (pose.upper + pose.lower) * Math.PI / 180;
  const elbow = [160 + 75 * Math.cos(upper), 214 + 75 * Math.sin(upper)];
  const hand = [elbow[0] + 65 * Math.cos(forearm), elbow[1] + 65 * Math.sin(forearm)];
  assert.ok(elbow[0] > 210 && elbow[1] < 175, 'elbow crosses the chest to the lower face');
  assert.ok(hand[0] > 240 && hand[0] < 270, 'hand ends beside the opposite ear');
  assert.ok(hand[1] > 100 && hand[1] < 140, 'hand stays at ear height');
  assert.ok(Math.abs(pose.lower) < 150, 'elbow flexion stays in a natural range');
  assert.equal(Lessons.frame('chicken-wing', 1).cough, false);
  assert.equal(Lessons.frame('chicken-wing', 5).upper, Lessons.frame('chicken-wing', 0).upper);
});
test('short handwashing demonstration includes wet, soap, scrub, rinse and dry', () => {
  for (const [seconds, phase] of [[0,'wet'],[.8,'soap'],[2,'scrub'],[3.7,'rinse'],[4.5,'dry']]) {
    assert.equal(Lessons.frame('wash-hands', seconds).phase, phase);
  }
  assert.equal(Lessons.frame('wash-hands', 2).water, false);
  assert.equal(Lessons.frame('wash-hands', 2).bubbles, true);
});
test('reduced motion keeps teaching poses without repetitive movement', () => {
  assert.equal(Lessons.frame('chicken-wing', 2, true).bounce, 0);
  assert.equal(Lessons.frame('wash-hands', 2, true).rub, 0);
});

test('Chicken Wing markup resets to the same resting pose as the finished animation', () => {
  const markup = Lessons.markup('chicken-wing');
  for (const time of [0, 5]) {
    const pose = Lessons.frame('chicken-wing', time);
    assert.ok(markup.includes(`data-part="upper" transform="rotate(${pose.upper})"`));
    assert.ok(markup.includes(`data-part="lower" transform="rotate(${pose.lower})"`));
    assert.ok(markup.includes(`data-part="head" transform="rotate(${pose.lean} 200 177)"`));
  }
});
