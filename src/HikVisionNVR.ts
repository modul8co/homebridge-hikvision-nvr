import { HikvisionApi, HikVisionNvrApiConfiguration } from "./HikvisionApi";
import { HikVisionCamera } from "./HikVisionCamera";
import { HIKVISION_PLATFORM_NAME, HIKVISION_PLUGIN_NAME } from ".";

import { API, PlatformAccessory, PlatformConfig } from "homebridge";

export class HikVisionNVR {
  private homebridgeApi: API;
  private log: any;

  config: HikVisionNvrApiConfiguration;
  hikVisionApi: HikvisionApi;
  cameras: HikVisionCamera[];

  constructor(logger: any, config: PlatformConfig, api: API) {
    this.hikVisionApi = new HikvisionApi(config as HikVisionNvrApiConfiguration);
    this.homebridgeApi = api;
    this.log = logger;
    this.config = config as HikVisionNvrApiConfiguration;
    this.cameras = [];

    this.log("Initialising accessories for HikVision NVR...");

    this.homebridgeApi.on(
      "didFinishLaunching",
      this.startMonitoring.bind(this)
    );

    this.loadAccessories();
  }

  async loadAccessories() {
    const systemInformation = await this.hikVisionApi.getSystemInfo();
    this.log.info("Connected to NVR system: %O", systemInformation)

    this.log.info("Loading cameras...");
    const apiCameras = await this.hikVisionApi.getCameras();
    this.log.info("Loaded %O cameras", apiCameras.length);

    const newAccessories = apiCameras.map((channel: {
      id: string;
      name: string;
      capabilities: any;
    }) => {

      const cameraConfig = {
        accessory: "camera",
        name: channel.name,
        channelId: channel.id,
        hasAudio: channel.capabilities ? !!channel.capabilities.StreamingChannel.Audio : false,
      };

      const cameraUUID = this.homebridgeApi.hap.uuid.generate(
        HIKVISION_PLUGIN_NAME + systemInformation.deviceID + cameraConfig.channelId
      );
      const accessory: PlatformAccessory = new this.homebridgeApi.platformAccessory(
        cameraConfig.name,
        cameraUUID
      );
      accessory.context = cameraConfig;

      // Only add new cameras that are not cached
      if (!this.cameras.find((x) => x.UUID === accessory.UUID)) {
        this.configureAccessory(accessory); // abusing the configureAccessory here
        this.homebridgeApi.registerPlatformAccessories(
          HIKVISION_PLUGIN_NAME,
          HIKVISION_PLATFORM_NAME,
          [accessory]
        );
      }

      return accessory;
    });


    this.log.info("Registering cameras with homebridge");

  }

  async configureAccessory(accessory: PlatformAccessory) {
    this.log(`Configuring accessory ${accessory.displayName}`);

    accessory.context = Object.assign(accessory.context, this.config);
    const camera = new HikVisionCamera(this.log, this.homebridgeApi, accessory);

    const cameraAccessoryInfo = camera.getService(
      this.homebridgeApi.hap.Service.AccessoryInformation
    );
    cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Manufacturer, 'HikVision');
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.Model, systemInformation.DeviceInfo.model);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.SerialNumber, systemInformation.DeviceInfo.serialNumber);
    // cameraAccessoryInfo!.setCharacteristic(this.homebridgeApi.hap.Characteristic.FirmwareRevision, systemInformation.DeviceInfo.firmwareVersion);

    this.cameras.push(camera);
  }

  private processHikVisionEvent(event: any) {
    switch (event.EventNotificationAlert.eventType) {
      case "videoloss":
        break;
      case "fielddetection":
      case "linedetection":
      case "shelteralarm":
      case "VMD":
        const motionDetected =
          event.EventNotificationAlert.eventState === "active";
        const channelId = event.EventNotificationAlert.dynChannelID;

        const camera = this.cameras.find(
          (camera) => camera.accessory.context.channelId === channelId
        );
        if (!camera) {
          return this.log.warn("Could not find camera for event", event);
        }

        this.log.info(
          "Motion detected on camera, triggering motion for ",
          camera.displayName
        );

        if (motionDetected !== camera.motionDetected) {
          camera.motionDetected = motionDetected;
          const motionService = camera.getService(
            this.homebridgeApi.hap.Service.MotionSensor
          );
          motionService?.setCharacteristic(
            this.homebridgeApi.hap.Characteristic.MotionDetected,
            motionDetected
          );

          setTimeout(() => {
            this.log.info("Disabling motion detection on camera", camera.displayName);
            camera.motionDetected = !motionDetected;
            camera
              .getService(this.homebridgeApi.hap.Service.MotionSensor)
              ?.setCharacteristic(
                this.homebridgeApi.hap.Characteristic.MotionDetected,
                !motionDetected
              );
          }, this.config.motionRetriggerInSeconds * 1000);
        }

      default:
        this.log.info("event", event);
    }
  }

  startMonitoring() {
    this.hikVisionApi.startMonitoringEvents(
      this.processHikVisionEvent.bind(this), this.log
    );
  }
}
