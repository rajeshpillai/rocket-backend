package engine

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

type QueryPlan struct {
	Entity   *metadata.Entity
	Filters  []WhereClause
	Sorts    []OrderClause
	Page     int
	PerPage  int
	Includes []string
}

type WhereClause struct {
	Field    string
	Operator string
	Value    any
}

type OrderClause struct {
	Field string
	Dir   string // ASC or DESC
}

type QueryResult struct {
	SQL    string
	Params []any
}

// ParseQueryParams parses Fiber query parameters into a QueryPlan.
func ParseQueryParams(c *fiber.Ctx, entity *metadata.Entity, reg *metadata.Registry) (*QueryPlan, error) {
	plan := &QueryPlan{
		Entity:  entity,
		Page:    1,
		PerPage: 25,
	}

	// Parse filters: filter[field]=val or filter[field.op]=val
	queries := c.Queries()
	for key, val := range queries {
		if !strings.HasPrefix(key, "filter[") || !strings.HasSuffix(key, "]") {
			continue
		}
		inner := key[7 : len(key)-1] // extract between [ and ]
		field, op := parseFilterKey(inner)

		if !entity.HasField(field) {
			return nil, &AppError{
				Code:    "UNKNOWN_FIELD",
				Status:  400,
				Message: fmt.Sprintf("Unknown filter field: %s", field),
			}
		}

		coerced, err := coerceValue(entity.GetField(field), val, op)
		if err != nil {
			return nil, &AppError{
				Code:    "INVALID_PAYLOAD",
				Status:  400,
				Message: fmt.Sprintf("Invalid filter value for %s: %v", field, err),
			}
		}

		plan.Filters = append(plan.Filters, WhereClause{
			Field:    field,
			Operator: op,
			Value:    coerced,
		})
	}

	// Parse sort: sort=-created_at,name
	if sortParam := c.Query("sort"); sortParam != "" {
		parts := strings.Split(sortParam, ",")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			dir := "ASC"
			field := part
			if strings.HasPrefix(part, "-") {
				dir = "DESC"
				field = part[1:]
			}
			if !entity.HasField(field) {
				return nil, &AppError{
					Code:    "UNKNOWN_FIELD",
					Status:  400,
					Message: fmt.Sprintf("Unknown sort field: %s", field),
				}
			}
			plan.Sorts = append(plan.Sorts, OrderClause{Field: field, Dir: dir})
		}
	}

	// Parse pagination
	if p := c.Query("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			plan.Page = v
		}
	}
	if pp := c.Query("per_page"); pp != "" {
		if v, err := strconv.Atoi(pp); err == nil && v > 0 {
			plan.PerPage = v
			if plan.PerPage > 100 {
				plan.PerPage = 100
			}
		}
	}

	// Parse includes: include=items,customer
	if inc := c.Query("include"); inc != "" {
		parts := strings.Split(inc, ",")
		for _, name := range parts {
			name = strings.TrimSpace(name)
			rel := reg.FindRelationForEntity(name, entity.Name)
			if rel == nil {
				return nil, &AppError{
					Code:    "UNKNOWN_FIELD",
					Status:  400,
					Message: fmt.Sprintf("Unknown include: %s", name),
				}
			}
			plan.Includes = append(plan.Includes, name)
		}
	}

	return plan, nil
}

// BuildSelectSQL builds a parameterized SELECT statement from the query plan.
func BuildSelectSQL(plan *QueryPlan, dialect store.Dialect) QueryResult {
	pb := dialect.NewParamBuilder()
	entity := plan.Entity

	columns := strings.Join(entity.FieldNames(), ", ")
	if entity.SoftDelete && entity.GetField("deleted_at") == nil {
		columns += ", deleted_at"
	}

	var where []string

	// Soft delete filter
	if entity.SoftDelete {
		where = append(where, "deleted_at IS NULL")
	}

	// User filters
	for _, f := range plan.Filters {
		clause := buildWhereClause(f, pb, dialect)
		where = append(where, clause)
	}

	sql := fmt.Sprintf("SELECT %s FROM %s", columns, entity.Table)
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}

	// Sort
	if len(plan.Sorts) > 0 {
		var orderParts []string
		for _, s := range plan.Sorts {
			orderParts = append(orderParts, fmt.Sprintf("%s %s", s.Field, s.Dir))
		}
		sql += " ORDER BY " + strings.Join(orderParts, ", ")
	}

	// Pagination
	limit := pb.Add(plan.PerPage)
	offset := pb.Add((plan.Page - 1) * plan.PerPage)
	sql += fmt.Sprintf(" LIMIT %s OFFSET %s", limit, offset)

	return QueryResult{SQL: sql, Params: pb.Params()}
}

// BuildCountSQL builds a COUNT query with the same filters as the select.
func BuildCountSQL(plan *QueryPlan, dialect store.Dialect) QueryResult {
	pb := dialect.NewParamBuilder()
	entity := plan.Entity

	var where []string
	if entity.SoftDelete {
		where = append(where, "deleted_at IS NULL")
	}
	for _, f := range plan.Filters {
		clause := buildWhereClause(f, pb, dialect)
		where = append(where, clause)
	}

	sql := fmt.Sprintf("SELECT COUNT(*) FROM %s", entity.Table)
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}

	return QueryResult{SQL: sql, Params: pb.Params()}
}

func buildWhereClause(f WhereClause, pb store.ParamBuilder, dialect store.Dialect) string {
	switch f.Operator {
	case "eq", "":
		return fmt.Sprintf("%s = %s", f.Field, pb.Add(f.Value))
	case "neq":
		return fmt.Sprintf("%s != %s", f.Field, pb.Add(f.Value))
	case "gt":
		return fmt.Sprintf("%s > %s", f.Field, pb.Add(f.Value))
	case "gte":
		return fmt.Sprintf("%s >= %s", f.Field, pb.Add(f.Value))
	case "lt":
		return fmt.Sprintf("%s < %s", f.Field, pb.Add(f.Value))
	case "lte":
		return fmt.Sprintf("%s <= %s", f.Field, pb.Add(f.Value))
	case "in":
		values, ok := f.Value.([]any)
		if !ok {
			return fmt.Sprintf("%s = %s", f.Field, pb.Add(f.Value))
		}
		return dialect.InExpr(f.Field, pb, values)
	case "not_in":
		values, ok := f.Value.([]any)
		if !ok {
			return fmt.Sprintf("%s != %s", f.Field, pb.Add(f.Value))
		}
		return dialect.NotInExpr(f.Field, pb, values)
	case "like":
		return fmt.Sprintf("%s LIKE %s", f.Field, pb.Add(f.Value))
	default:
		return fmt.Sprintf("%s = %s", f.Field, pb.Add(f.Value))
	}
}

// parseFilterKey splits "total.gte" into ("total", "gte") or "status" into ("status", "eq").
func parseFilterKey(key string) (string, string) {
	parts := strings.SplitN(key, ".", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return key, "eq"
}

// coerceValue converts string query param values to appropriate Go types based on field metadata.
func coerceValue(field *metadata.Field, val string, op string) (any, error) {
	// Handle "in" and "not_in" as comma-separated arrays
	if op == "in" || op == "not_in" {
		parts := strings.Split(val, ",")
		coerced := make([]any, len(parts))
		for i, p := range parts {
			v, err := coerceSingleValue(field, strings.TrimSpace(p))
			if err != nil {
				return nil, err
			}
			coerced[i] = v
		}
		return coerced, nil
	}

	return coerceSingleValue(field, val)
}

func coerceSingleValue(field *metadata.Field, val string) (any, error) {
	switch field.Type {
	case "int":
		return strconv.Atoi(val)
	case "bigint":
		return strconv.ParseInt(val, 10, 64)
	case "decimal":
		return strconv.ParseFloat(val, 64)
	case "boolean":
		return strconv.ParseBool(val)
	default:
		return val, nil
	}
}
