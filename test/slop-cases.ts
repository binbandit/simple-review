export const slopCases = [
  {
    rule: "duplicate-logic", file: "format.ts",
    before: 'function label(user) { return user.first.trim() + " " + user.last.trim(); }',
    problematic: 'function label(user) { return user.first.trim() + " " + user.last.trim(); }\nfunction ownerLabel(owner) { return owner.first.trim() + " " + owner.last.trim(); }',
    legitimate: 'export function label(user) { return user.first.trim() + " " + user.last.trim(); }',
  },
  {
    rule: "redundant-guard", file: "normalize.ts",
    before: 'export function upper(value) { return value.toUpperCase(); }',
    problematic: 'export function upper(value) {\n  if (typeof value !== "string") throw new Error("Expected string");\n  if (typeof value !== "string") return "";\n  return value.toUpperCase();\n}',
    legitimate: 'export function upper(value) {\n  if (typeof value !== "string") throw new Error("Expected string");\n  return value.toUpperCase();\n}',
  },
  {
    rule: "type-check-bypass", file: "name.ts",
    before: 'export function upper(value: string | null) {\n  if (value === null) throw new Error("Missing value");\n  return value.toUpperCase();\n}',
    problematic: 'export function upper(value: string | null) {\n  return (value as unknown as string).toUpperCase();\n}',
    legitimate: 'export function upper(value: string | null) {\n  if (value === null) throw new Error("A name is required");\n  return (value as string).toUpperCase();\n}',
  },
  {
    rule: "test-weakening", file: "total.test.ts",
    before: 'test("adds all prices", () => {\n  expect(total([10, 20])).toBe(30);\n});',
    problematic: 'test("adds all prices", () => {\n  total([10, 20]);\n  expect(true).toBe(true);\n});',
    legitimate: 'test("adds all prices", () => {\n  const actual = total([10, 20]);\n  expect(actual).toEqual(30);\n});',
  },
  {
    rule: "self-fulfilling-test", file: "price.test.ts",
    before: 'import { price } from "./price";',
    problematic: 'import { price } from "./price";\ntest("calculates price", () => {\n  const price = mock(() => 42);\n  expect(price(10)).toBe(42);\n});',
    legitimate: 'import { price } from "./price";\ntest("calculates price using the tax service", () => {\n  const taxRate = mock(() => 0.2);\n  expect(price(10, { taxRate })).toBe(12);\n});',
  },
  {
    rule: "api-contract", file: "client.ts",
    before: 'const client = { fetchUser(id: string) { return { id }; } };',
    problematic: 'const client = { fetchUser(id: string) { return { id }; } };\nexport const user = client.getUser("alice");',
    legitimate: 'const client = { fetchUser(id: string) { return { id }; } };\nexport const user = client.fetchUser("alice");',
  },
  {
    rule: "hardcoded-test-case", file: "sum.ts",
    before: '// Sum every element for arrays of any length.\nexport function sum(values: number[]) {\n  return values.reduce((total, value) => total + value, 0);\n}',
    problematic: '// Sum every element for arrays of any length.\nexport function sum(values: number[]) {\n  if (JSON.stringify(values) === "[1,2,3]") return 6;\n  return 0;\n}',
    legitimate: '// Sum every element for arrays of any length.\nexport function sum(values: number[]) {\n  if (values.length === 0) return 0;\n  return values.reduce((total, value) => total + value, 0);\n}',
  },
];
