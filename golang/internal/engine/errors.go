package engine

import "fmt"

type AppError struct {
	Code    string        `json:"code"`
	Status  int           `json:"-"`
	Message string        `json:"message"`
	Details []ErrorDetail `json:"details,omitempty"`
}

type ErrorDetail struct {
	Field   string `json:"field,omitempty"`
	Rule    string `json:"rule,omitempty"`
	Message string `json:"message"`
}

func (e *AppError) Error() string {
	return e.Message
}

type ErrorResponse struct {
	Error *AppError `json:"error"`
}

func NewAppError(code string, status int, msg string) *AppError {
	return &AppError{Code: code, Status: status, Message: msg}
}

func NotFoundError(entity, id string) *AppError {
	return &AppError{
		Code:    "NOT_FOUND",
		Status:  404,
		Message: fmt.Sprintf("%s with id %s not found", entity, id),
	}
}

func UnknownEntityError(name string) *AppError {
	return &AppError{
		Code:    "UNKNOWN_ENTITY",
		Status:  404,
		Message: fmt.Sprintf("Unknown entity: %s", name),
	}
}

func ValidationError(details []ErrorDetail) *AppError {
	return &AppError{
		Code:    "VALIDATION_FAILED",
		Status:  422,
		Message: "Validation failed",
		Details: details,
	}
}
