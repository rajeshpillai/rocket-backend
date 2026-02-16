package metadata

// UserContext represents the authenticated user, set by auth middleware.
type UserContext struct {
	ID    string   `json:"id"`
	Roles []string `json:"roles"`
}

// HasRole checks whether the user has a specific role.
func (u *UserContext) HasRole(role string) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// IsAdmin checks whether the user has the admin role.
func (u *UserContext) IsAdmin() bool {
	return u.HasRole("admin")
}
