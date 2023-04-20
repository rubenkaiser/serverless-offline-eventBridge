/* eslint-disable class-methods-use-this */
/* eslint-disable import/prefer-default-export */

declare module 'serverless-offline/lambda' {
  export class Lambda {
    functionKey = '';

    #httpServer = null;

    #lambdas = new Map();

    #lambdaFunctionNamesKeys = new Map();

    #lambdaFunctionPool = null;

    constructor(_serverless, _options) {
      this.#httpServer = {};
      this.#lambdaFunctionPool = {};
    }

    #createEvent(functionKey, functionDefinition) {
      this.#lambdas.set(functionKey, functionDefinition);
      this.#lambdaFunctionNamesKeys.set(functionDefinition.name, functionKey);
    }

    create(lambdas: Array<Lambda>) {
      lambdas.forEach(({ functionKey, functionDefinition }) => {
        this.#createEvent(functionKey, functionDefinition);
      });
    }

    get(functionKey) {
      const functionDefinition = this.#lambdas.get(functionKey);
      return this.#lambdaFunctionPool.get(functionKey, functionDefinition);
    }

    getByFunctionName(functionName) {
      const functionKey = this.#lambdaFunctionNamesKeys.get(functionName);
      return this.get(functionKey);
    }

    listFunctionNames() {
      const functionNames = Array.from(this.#lambdaFunctionNamesKeys.keys());
      return functionNames;
    }

    listFunctionNamePairs() {
      const funcNamePairs = Array.from(this.#lambdaFunctionNamesKeys).reduce(
        (obj, [key, value]) => Object.assign(obj, { [key]: value }), // Be careful! Maps can have non-String keys; object literals can't.
        {}
      );
      return funcNamePairs;
    }

    start() {
      this.#lambdaFunctionPool.start();

      return this.#httpServer.start();
    }

    // stops the server
    stop(_timeout) {}

    cleanup() {
      return Promise.resolve();
    }
  }
}
