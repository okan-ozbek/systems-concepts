import { expect, it } from 'vitest';
import { explainMoment } from './lab-model';
import type { TraceMoment } from './lab-types';

const moment:TraceMoment={line:1,phase:'after',variables:[],output:''};
const explain=(source:string,phase:TraceMoment['phase']='after')=>explainMoment({...moment,phase},source);

it('does not fabricate a DRAM miss when an indexed access has no captured address',()=>{
  const step=explain('int loaded = values[2];');
  expect(step.route[0]).toBe('reg0');
  expect(step.route).not.toContain('dram');
  expect(step.route.at(-1)).toBe('reg0');
  expect(step.detail).toContain('no supported address');
});

it('requires captured addresses for linked-list cache traffic',()=>{
  for(const code of ['curr = curr->next;', 'while (curr->next != nullptr) {', 'std::cout << curr->value << std::endl;']){
    expect(explain(code).route,code).not.toContain('dram');
  }
  expect(explain('std::cout << curr->value << std::endl;').route.at(-1)).toBe('io');
});

it('distinguishes heap allocation from pointer assignment',()=>{
  expect(explain('auto node = new Node(10, node2);').detail).toContain('not instrumented');
  expect(explain('auto curr = node;').route).not.toContain('dram');
});

it('does not claim that a store is an immediate DRAM write',()=>{
  for(const code of ['values[1] = loaded + 5;', 'curr->value = 42;', 'values[i] += 1;', '++values[i];']){
    const step=explain(code);
    expect(step.route,code).toEqual(['reg0']);
    expect(step.detail).toContain('no supported address');
  }
});

it('ignores memory-looking strings and comments while preserving source lines',()=>{
  expect(explain('std::cout << "new node->value values[i]";').route).toEqual(['reg0','io']);
  expect(explain('int x = 1; // new Node(10), curr->value').route).not.toContain('dram');
  expect(explainMoment({...moment,line:2},'/* new Node\n curr->value */ int x = 1;').route).not.toContain('dram');
});

it('keeps scope entry separate from evaluating its condition',()=>{
  expect(explain('while (curr->next != nullptr) {','entry').route).toEqual(['reg0']);
  expect(explain('while (curr->next != nullptr) {','before').route).not.toContain('dram');
});
