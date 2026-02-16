/**
 * ExpressionEvaluator abstracts condition evaluation for workflow steps.
 * Implementations can use different expression engines (Function constructor,
 * sandboxed evaluator, etc.) without coupling the workflow engine to a specific one.
 */
export interface ExpressionEvaluator {
  evaluateBool(expression: string, env: Record<string, any>): boolean;
}

/**
 * FunctionExpressionEvaluator uses the Function constructor with a `with` block.
 * This matches the existing approach used across the Express codebase (rules, webhooks).
 * Compiled functions are cached by expression string for reuse.
 */
export class FunctionExpressionEvaluator implements ExpressionEvaluator {
  private cache = new Map<string, (env: Record<string, any>) => boolean>();

  evaluateBool(expression: string, env: Record<string, any>): boolean {
    let fn = this.cache.get(expression);
    if (!fn) {
      fn = new Function(
        "env",
        `with (env) { return !!(${expression}); }`,
      ) as (env: Record<string, any>) => boolean;
      this.cache.set(expression, fn);
    }
    return fn(env);
  }
}
