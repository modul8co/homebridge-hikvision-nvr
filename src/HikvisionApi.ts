import { Parser } from 'xml2js';
import { PlatformConfig } from 'homebridge';

export interface HikVisionNvrApiConfiguration extends PlatformConfig {
  host: string
  port: number
  secure: boolean
  ignoreInsecureTls: boolean
  username: string
  password: string
  debugFfmpeg: boolean
  motionRetriggerInSeconds: number
}

export class HikvisionApi {
  private _parser: Parser
  private _options: any
  private _urllib: any
  private _baseUrl: string

  constructor(config: HikVisionNvrApiConfiguration) {
    this._urllib = require('urllib');
    this._parser = new Parser({ explicitArray: false });
    this._baseUrl = `${config.host}:${config.port}`;   
    this._options = {
      method: 'GET',
      digestAuth: `${config.username}:${config.password}`
    };    
  }

  public async getSystemInfo() {
    return this._getResponse('/ISAPI/System/deviceInfo');
  }

  async getCameras() {
    const channels = await this._getResponse('/ISAPI/ContentMgmt/InputProxy/channels');
    const channelStatus = await this._getResponse('/ISAPI/ContentMgmt/InputProxy/channels/status');

    for (let i = 0; i < channels.InputProxyChannelList.InputProxyChannel.length; i++) {
      const channel = channels.InputProxyChannelList.InputProxyChannel[i];
      try {
        channel.capabilities = await this._getResponse(`/ISAPI/ContentMgmt/StreamingProxy/channels/${channel.id}01/capabilities`);
      } catch {
      }
    }

    return channels.InputProxyChannelList.InputProxyChannel.map((channel: { status: any; id: any; name: string }) => {
      channel.status = channelStatus.InputProxyChannelStatusList.InputProxyChannelStatus.find((cs: { id: any; }) => {
        return cs.id === channel.id;
      });
      return channel;
    }).filter((camera: { status: { online: string; }; }) => camera.status.online === 'true');
  }

  async startMonitoringEvents(callback: (value: any) => any, logger: any) {
    const url = `/ISAPI/Event/notification/alertStream`;
    const regex = new RegExp('<EventNotificationAlert.*>((.|\n)*?)<\/EventNotificationAlert>');
    const parser = this._parser;
    const responseHandler = (err: any, data: any, res: any) => {
      if (err) {
        logger.error(err);
      } else {
        logger.info('Connected to Event Stream on URL:', url);
      }
      if (res != null) {
        res.on('data', function (data: any) {
          var xml  = data.toString().match(regex);
          if(xml != null) {
            parser.parseString(xml[0], function(err: any,result: any){
              callback(result);
            }); 
          }
        });
        res.on('error', function (err: any) {
          logger.error(err);
        });
      }
    }
    let clonedOptions = Object.assign({}, this._options);
    clonedOptions.streaming = true;
    this._urllib.request(this._baseUrl + url, clonedOptions, responseHandler);
  }

  async get(url: string): Promise<string> {
    return this._urllib.request(this._baseUrl + url, this._options).then(function (result: any) {
      return result.data;
    }).catch(function (err: any) {
      console.error(err);
    });
  }

  private async _getResponse(path: string) {
    const response = await this.get(path);
    const responseJson = this._parser.parseStringPromise(response);
    return responseJson;
  }
}