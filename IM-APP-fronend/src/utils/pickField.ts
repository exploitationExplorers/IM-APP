/**
 * OpenIM App 原生桥用 PascalCase，Web SDK 用 camelCase。
 * 按 camelCase 键名自动再试首字母大写的字段。
 */
export function pickField<T = unknown>(source: unknown, camelKey: string): T | undefined {
  if (!source || typeof source !== 'object') return undefined
  const obj = source as Record<string, unknown>
  const pascalKey = camelKey.charAt(0).toUpperCase() + camelKey.slice(1)
  const camel = obj[camelKey]
  if (camel !== undefined && camel !== null && camel !== '') return camel as T
  const pascal = obj[pascalKey]
  if (pascal !== undefined && pascal !== null && pascal !== '') return pascal as T
  return undefined
}
