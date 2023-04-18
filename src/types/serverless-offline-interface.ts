/** Haven't found interface for Offline plugin options. Need to do PR to create @types/serverless-offline
* Options list: https://github.com/dherault/serverless-offline#usage-and-command-line-options
* @example 
    custom:
        serverless-offline:
            httpsProtocol: 'dev-certs'
            httpPort: 4000
            foo: 'bar'
*/
export interface ServerlessOfflinePluginOptions {
  httpPort?: number;
}
