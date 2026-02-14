export interface InExprResult {
  sql: string;
  params: any[];
  nextOffset: number;
}

export interface IntervalResult {
  sql: string;
  nextOffset: number;
}

export interface Dialect {
  name(): string;
  placeholder(n: number): string;
  nowExpr(): string;
  systemTablesSQL(): string;
  platformTablesSQL(): string;
  columnType(fieldType: string, precision?: number): string;
  tableExists(q: any, tableName: string): Promise<boolean>;
  getColumns(q: any, tableName: string): Promise<Map<string, string>>;
  createDatabase(q: any, dbName: string, dataDir?: string): Promise<void>;
  dropDatabase(q: any, dbName: string, dataDir?: string): Promise<void>;
  inExpr(field: string, values: any[], offset: number): InExprResult;
  notInExpr(field: string, values: any[], offset: number): InExprResult;
  arrayParam(vals: any[]): any;
  scanArray(raw: any): any[];
  needsBoolFix(): boolean;
  supportsPercentile(): boolean;
  filterCountExpr(condition: string): string;
  syncCommitOff(): string | null;
  intervalDeleteExpr(col: string, offset: number): IntervalResult;
  uuidDefault(): string;
}

// Import both dialect implementations
import { PostgresDialect } from "./dialect-postgres.js";
import { SQLiteDialect } from "./dialect-sqlite.js";

export function newDialect(driver: string): Dialect {
  switch (driver) {
    case "sqlite":
      return new SQLiteDialect();
    case "postgres":
    default:
      return new PostgresDialect();
  }
}
