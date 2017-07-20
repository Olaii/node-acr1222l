
module.exports = class AppError extends Error {
    constructor (message, status) {

        // Calling parent constructor of base Error class.
        super(message);

        // Capturing stack trace, excluding constructor call from it.
        Error.captureStackTrace(this, this.constructor);

        // Saving class name in the property of our custom error as a shortcut.
        this.name = this.constructor.name;

        // You can use any additional properties you want.
        // `500` is the default value if not specified.
        this.status = status || 'READER_ERROR';

    }
};