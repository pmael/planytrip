/** Something the caller asked for does not exist. Becomes a 404. */
export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "NotFoundError";
  }
}

/** One input is wrong in a way the schema cannot see (e.g. an unknown city). Becomes a 400 on that field. */
export class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

/** The request is fine but cannot be done in the state things are in. Becomes a 409. */
export class ConflictError extends Error {
  constructor(
    /** A short code the UI can act on, e.g. "no_destinations" */
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
