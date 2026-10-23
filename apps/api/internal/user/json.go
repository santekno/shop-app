package user

import "time"

// JSON is a user as the API sends it (User in api/openapi.yaml). It lives
// here, next to the model, because both the auth endpoints (register,
// login) and /v1/me return it, and they must not drift apart.
type JSON struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	Phone         *string   `json:"phone"` // no omitempty: the contract wants null
	Role          Role      `json:"role"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

// ToJSON returns u in the contract's shape.
func ToJSON(u User) JSON {
	return JSON{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		Phone:         u.Phone,
		Role:          u.Role,
		EmailVerified: u.EmailVerified(),
		CreatedAt:     u.CreatedAt.UTC(),
	}
}
