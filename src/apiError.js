'use strict';

// Port of backend/.../web/ApiException.java + service/AuthService.java.

class ApiError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : JSON.stringify(body));
    this.status = status;
    // String detail -> { detail } envelope like ApiException(status, detail).
    this.body = typeof body === 'string' ? { detail: body } : body;
  }
}

module.exports = { ApiError };
