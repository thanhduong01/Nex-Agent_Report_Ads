import test from "node:test";
import assert from "node:assert/strict";
import { calculateFormula, evaluateMetrics, validateMetrics } from "../agent/lib/formulas.ts";

test("formulas respect precedence, comparisons, conditional branches and rounding", () => {
  assert.equal(calculateFormula("2 + 3 * 4", {}).value, 14);
  assert.equal(calculateFormula("ROUND(chi_phi / tin_nhan, 2)", {chi_phi:100,tin_nhan:3}).value,33.33);
  assert.equal(calculateFormula("IF(tin_nhan > 0, chi_phi / tin_nhan, NULL)", {chi_phi:100,tin_nhan:0}).value,null);
  assert.equal(calculateFormula("SUM(2, ABS(-3), MAX(1, 4))", {}).value,9);
  assert.equal(calculateFormula("COALESCE(x, 7)", {x:null}).value,7);
});
test("missing data, zero division and non-finite results are unavailable while explicit zero is valid", () => {
  assert.equal(calculateFormula("chi_phi / tin_nhan", {chi_phi:0,tin_nhan:2}).value,0);
  assert.equal(calculateFormula("chi_phi / tin_nhan", {chi_phi:100,tin_nhan:0}).value,null);
  assert.match(calculateFormula("chi_phi + x", {chi_phi:100,x:null}).reason!,/Thiếu/);
  assert.equal(calculateFormula("10 ^ 100", {}).value,null);
});
test("metric dependencies calculate in any order and totals use aggregated operands", () => {
  const definitions=[{id:"sau_phi",formula:"chi_phi + phi"},{id:"cp_mess",formula:"sau_phi / tin_nhan"}];
  validateMetrics(definitions,["phi"]);
  const result=evaluateMetrics(definitions,{chi_phi:300,tin_nhan:11,phi:30});
  assert.equal(result.cp_mess.value,30);
  assert.notEqual(result.cp_mess.value,(100/1+200/10)/2);
});
test("unsafe syntax, unknown names, prototype names, cycles and excessive work are rejected", () => {
  for(const expression of ["globalThis.process.exit()","constructor.constructor('return process')()","x[0]","fetch(1)","1;2","__proto__","(" .repeat(50)+"1"+")".repeat(50)]) {
    assert.throws(()=>calculateFormula(expression,{}),/Công thức/);
  }
  assert.throws(()=>validateMetrics([{id:"a",formula:"missing + 1"}]),/không tồn tại/);
  assert.throws(()=>validateMetrics([{id:"a",formula:"b"},{id:"b",formula:"a"}]),/vòng/);
  assert.throws(()=>validateMetrics([{id:"chi_phi",formula:"1"}]),/trùng/);
  assert.throws(()=>calculateFormula("1+".repeat(300)+"1",{}),/Công thức/);
});
