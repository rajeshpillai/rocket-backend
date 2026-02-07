package engine

import (
	"fmt"
	"strings"

	"rocket-backend/internal/metadata"
)

// CheckPermission verifies that the user is allowed to perform the given action
// on the given entity. For update/delete, currentRecord is the existing record
// to check conditions against. Returns nil if allowed, or a FORBIDDEN AppError.
func CheckPermission(user *metadata.UserContext, entity, action string, reg *metadata.Registry, currentRecord map[string]any) error {
	if user == nil {
		return UnauthorizedError("Authentication required")
	}

	// Admin bypasses all permission checks
	if user.IsAdmin() {
		return nil
	}

	policies := reg.GetPermissions(entity, action)
	if len(policies) == 0 {
		return ForbiddenError(fmt.Sprintf("No permission for %s on %s", action, entity))
	}

	// Check each policy — if ANY passes, the action is allowed
	for _, p := range policies {
		if !hasRoleIntersection(user.Roles, p.Roles) {
			continue
		}
		// Role matches — now check conditions
		if len(p.Conditions) == 0 {
			return nil // No conditions, role match is sufficient
		}
		if currentRecord != nil && evaluateConditions(p.Conditions, currentRecord) {
			return nil
		}
		// For create, there's no current record — conditions don't apply
		if currentRecord == nil && (action == "create" || action == "read") {
			return nil
		}
	}

	return ForbiddenError(fmt.Sprintf("Permission denied for %s on %s", action, entity))
}

// GetReadFilters returns extra WhereClause entries to inject into read queries
// for row-level security. Admin users get no filters (full access).
func GetReadFilters(user *metadata.UserContext, entity string, reg *metadata.Registry) []WhereClause {
	if user == nil || user.IsAdmin() {
		return nil
	}

	policies := reg.GetPermissions(entity, "read")
	if len(policies) == 0 {
		return nil
	}

	var filters []WhereClause
	for _, p := range policies {
		if !hasRoleIntersection(user.Roles, p.Roles) {
			continue
		}
		for _, cond := range p.Conditions {
			filters = append(filters, WhereClause{
				Field:    cond.Field,
				Operator: cond.Operator,
				Value:    cond.Value,
			})
		}
	}
	return filters
}

func hasRoleIntersection(userRoles, policyRoles []string) bool {
	for _, ur := range userRoles {
		for _, pr := range policyRoles {
			if strings.EqualFold(ur, pr) {
				return true
			}
		}
	}
	return false
}

func evaluateConditions(conditions []metadata.PermissionCondition, record map[string]any) bool {
	for _, cond := range conditions {
		val, ok := record[cond.Field]
		if !ok {
			return false
		}
		if !evaluateCondition(cond.Operator, val, cond.Value) {
			return false
		}
	}
	return true
}

func evaluateCondition(operator string, recordVal, condVal any) bool {
	switch operator {
	case "eq":
		return fmt.Sprintf("%v", recordVal) == fmt.Sprintf("%v", condVal)
	case "neq":
		return fmt.Sprintf("%v", recordVal) != fmt.Sprintf("%v", condVal)
	case "in":
		return valueInList(recordVal, condVal)
	case "not_in":
		return !valueInList(recordVal, condVal)
	case "gt":
		return compareNumeric(recordVal, condVal) > 0
	case "gte":
		return compareNumeric(recordVal, condVal) >= 0
	case "lt":
		return compareNumeric(recordVal, condVal) < 0
	case "lte":
		return compareNumeric(recordVal, condVal) <= 0
	default:
		return false
	}
}

func valueInList(val, list any) bool {
	valStr := fmt.Sprintf("%v", val)
	switch l := list.(type) {
	case []any:
		for _, item := range l {
			if fmt.Sprintf("%v", item) == valStr {
				return true
			}
		}
	case []string:
		for _, item := range l {
			if item == valStr {
				return true
			}
		}
	}
	return false
}

func compareNumeric(a, b any) int {
	fa := toFloat(a)
	fb := toFloat(b)
	if fa < fb {
		return -1
	}
	if fa > fb {
		return 1
	}
	return 0
}

func toFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case int32:
		return float64(n)
	default:
		var f float64
		fmt.Sscanf(fmt.Sprintf("%v", v), "%f", &f)
		return f
	}
}
