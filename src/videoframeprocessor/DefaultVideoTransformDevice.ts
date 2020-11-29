// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import DefaultBrowserBehavior from '../browserbehavior/DefaultBrowserBehavior';
import Device from '../devicecontroller/Device';
import VideoTransformDevice from '../devicecontroller/VideoTransformDevice';
import Logger from '../logger/Logger';
import DefaultVideoFrameProcessorPipeline from './DefaultVideoFrameProcessorPipeline';
import DefaultVideoTransformDeviceObserver from './DefaultVideoTransformDeviceObserver';
import VideoFrameProcessor from './VideoFrameProcessor';
import VideoFrameProcessorPipeline from './VideoFrameProcessorPipeline';
import VideoFrameProcessorPipelineObserver from './VideoFrameProcessorPipelineObserver';

/**
 * [[DefaultVideoTransformDevice]] is an augmented [[VideoInputDevice]].
 * It transform the input [[Device]] with an array of [[VideoFrameProcessor]] to produce a `MediaStream`.
 */
export default class DefaultVideoTransformDevice
  implements VideoTransformDevice, VideoFrameProcessorPipelineObserver {
  private inputMediaStream: MediaStream;
  private observers: Set<DefaultVideoTransformDeviceObserver> = new Set<
    DefaultVideoTransformDeviceObserver
  >();

  constructor(
    private logger: Logger,
    private device: Device,
    private processors: VideoFrameProcessor[],
    private browserBehavior: DefaultBrowserBehavior = new DefaultBrowserBehavior(),
    private pipe: DefaultVideoFrameProcessorPipeline | null = null
  ) {}

  /**
   * getter for `outputMediaStream`.
   * `outputMediaStream` is returned by internal {@link VideoFrameProcessorPipeline}.
   */
  get outputMediaStream(): MediaStream | null {
    if (this.pipe) {
      return this.pipe.outputMediaStream;
    }
    return null;
  }

  chooseNewInnerDevice(newDevice: Device): DefaultVideoTransformDevice {
    const newTransformDevice = new DefaultVideoTransformDevice(
      this.logger,
      newDevice,
      this.processors,
      this.browserBehavior,
      this.pipe
    );

    this.observers.forEach(obs => {
      newTransformDevice.addObserver(obs);
    });

    return newTransformDevice;
  }

  /**
   * Return the inner device as provided during construction.
   */
  getInnerDevice(): Device {
    return this.device;
  }

  async intrinsicDevice(): Promise<Device> {
    const trackConstraints: MediaTrackConstraints = {};

    // Empty string and null.
    if (!this.device) {
      return trackConstraints;
    }

    // Device ID.
    if (typeof this.device === 'string') {
      if (this.browserBehavior.requiresNoExactMediaStreamConstraints()) {
        trackConstraints.deviceId = this.device;
      } else {
        trackConstraints.deviceId = { exact: this.device };
      }
      return trackConstraints;
    }

    if ((this.device as MediaStream).id) {
      // Nothing we can do.
      return this.device;
    }

    // It's constraints.
    return {
      ...this.device,
      ...trackConstraints,
    };
  }

  /**
   * Create {@link VideoFrameProcessorPipeline} if there is not a existing one and start video processors.
   * Returns output `MediaStream` produced by {@link VideoFrameProcessorPipeline}.
   */
  async applyProcessors(mediaStream?: MediaStream): Promise<MediaStream> {
    await this.createVideoFrameProcessorPipeline();
    await this.pipe.setInputMediaStream(mediaStream);
    this.inputMediaStream = mediaStream;
    return this.pipe.outputMediaStream;
  }

  /**
   * onOutputStreamDisconnect is called when device controller wants to detach the DefaultVideoTransformDevice
   * and attempts to release the output stream of the DefaultVideoTransformDevice.
   */
  onOutputStreamDisconnect(): void {
    this.logger.info('DefaultVideoTransformDevice: detach stopping input media stream');

    const deviceIsMediaStream = this.device && (this.device as MediaStream).id;

    // Stop processing but keep the pipe and processors
    if (this.pipe) {
      this.pipe.stop();
    }

    // Turn off the camera, unless device is a MediaStream
    if (!deviceIsMediaStream) {
      if (this.inputMediaStream) {
        for (const track of this.inputMediaStream.getVideoTracks()) {
          track.stop();
        }
      }
    }
  }

  /**
   * Dispose of the inner workings of the transform device.
   * This must be called to release resources properly.
   */
  async stop(): Promise<void> {
    if (this.pipe) {
      await this.pipe.setInputMediaStream(null);
    }

    if (this.inputMediaStream) {
      for (const track of this.inputMediaStream.getVideoTracks()) {
        track.stop();
      }
    }

    if (this.processors) {
      for (const proc of this.processors) {
        await proc.destroy();
      }
    }

    this.inputMediaStream = null;
    this.pipe = null;
    this.processors = null;
  }

  private async createVideoFrameProcessorPipeline(): Promise<VideoFrameProcessorPipeline> {
    if (!this.pipe) {
      this.pipe = new DefaultVideoFrameProcessorPipeline(this.logger);
      this.pipe.addObserver(this);
    }

    this.pipe.processors = this.processors;

    return this.pipe;
  }

  /**
   * Add an observer to receive notifications about lifecycle events.
   * See {@link DefaultVideoTransformDeviceObserver} for details.
   * If the observer has already been added, this method call has no effect.
   */
  addObserver(observer: DefaultVideoTransformDeviceObserver): void {
    this.observers.add(observer);
  }

  /**
   * Remove an existing observer. If the observer has not been previously. this method call has no effect.
   */
  removeObserver(observer: DefaultVideoTransformDeviceObserver): void {
    this.observers.add(observer);
  }

  processingDidStart(): void {
    this.logger.info('video transform device processing started');
    this.forEachObserver(observer => {
      if (observer.processingDidStart) {
        observer.processingDidStart();
      }
    });
  }

  processingLatencyTooHigh(latencyMs: number): void {
    this.forEachObserver(observer => {
      if (observer.processingLatencyTooHigh) {
        observer.processingLatencyTooHigh(latencyMs);
      }
    });
  }

  processingDidFailToStart(): void {
    this.logger.info('video transform device processing failed to start');
    this.forEachObserver(observer => {
      if (observer.processingDidFailToStart) {
        observer.processingDidFailToStart();
      }
    });
  }

  processingDidStop(): void {
    this.logger.info('video transform device processing stopped');
    this.forEachObserver(observer => {
      if (observer.processingDidStop) {
        observer.processingDidStop();
      }
    });
  }

  private forEachObserver(
    observerFunc: (observer: VideoFrameProcessorPipelineObserver) => void
  ): void {
    for (const observer of this.observers) {
      setTimeout(() => {
        observerFunc(observer);
      }, 0);
    }
  }
}
