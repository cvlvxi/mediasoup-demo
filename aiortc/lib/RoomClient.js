"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = void 0;
// @ts-ignore
const protoo_client_1 = __importDefault(require("protoo-client"));
const mediasoupClient = __importStar(require("mediasoup-client"));
const mediasoup_client_aiortc_1 = require("mediasoup-client-aiortc");
const Logger_1 = require("./Logger");
const urlFactory_1 = require("./urlFactory");
const stateActions = __importStar(require("./redux/stateActions"));
global.createWorker = mediasoup_client_aiortc_1.createWorker;
const PC_PROPRIETARY_CONSTRAINTS = {
    optional: [{ googDscp: true }]
};
const logger = new Logger_1.Logger('RoomClient');
let store;
class RoomClient {
    /**
     * @param  {Object} data
     * @param  {Object} data.store - The Redux store.
     */
    static init(data) {
        store = data.store;
    }
    constructor({ roomId, peerId, displayName, 
    // useSimulcast,
    useSharingSimulcast, forceTcp, produce, consume, forceH264, forceVP8, datachannel, externalAudio, externalVideo }) {
        // Closed flag.
        this._closed = false;
        // Device info.
        this._device = {
            flag: 'aiortc',
            name: 'aiortc',
            version: "9.9.9"
        };
        // Whether we want to force RTC over TCP.
        this._forceTcp = false;
        // Whether we want to produce audio/video.
        this._produce = true;
        // Whether we should consume.
        this._consume = true;
        // Whether we want DataChannels.
        this._useDataChannel = true;
        // External audio.
        this._externalAudio = '';
        // External video.
        this._externalVideo = '';
        // Next expected dataChannel test number.
        this._nextDataChannelTestNumber = 0;
        // Whether simulcast should be used in desktop sharing.
        this._useSharingSimulcast = false;
        // protoo-client Peer instance.
        this._protoo = null;
        // mediasoup-client Device instance.
        this._mediasoupDevice = null;
        // mediasoup Transport for sending.
        this._sendTransport = null;
        // mediasoup Transport for receiving.
        // @type {mediasoupClient.Transport}
        this._recvTransport = null;
        // Local mic mediasoup Producer.
        this._micProducer = null;
        // Local webcam mediasoup Producer.
        this._webcamProducer = null;
        // Local share mediasoup Producer.
        this._shareProducer = null;
        // Local chat DataProducer.
        this._chatDataProducer = null;
        // Local bot DataProducer.
        // @type {mediasoupClient.DataProducer}
        this._botDataProducer = null;
        // mediasoup Consumers.
        this._consumers = new Map();
        // mediasoup DataConsumers.
        // @type {Map<String, mediasoupClient.DataConsumer>}
        this._dataConsumers = new Map();
        logger.debug('constructor() [roomId:"%s", peerId:"%s", displayName:"%s", device:%s]', roomId, peerId, displayName, this._device.flag);
        this._displayName = displayName;
        this._forceTcp = forceTcp;
        this._produce = produce;
        this._consume = consume;
        this._useDataChannel = datachannel;
        this._externalAudio = externalAudio;
        this._externalVideo = externalVideo;
        this._useSharingSimulcast = useSharingSimulcast;
        this._protooUrl = (0, urlFactory_1.getProtooUrl)({ roomId, peerId });
        this._protoo = null;
    }
    close() {
        if (this._closed)
            return;
        this._closed = true;
        logger.debug('close()');
        // Close protoo Peer
        this._protoo.close();
        // Close mediasoup Transports.
        if (this._sendTransport)
            this._sendTransport.close();
        if (this._recvTransport)
            this._recvTransport.close();
        // Stop the local stats periodic timer.
        clearInterval(this._localStatsPeriodicTimer);
        store.dispatch(stateActions.setRoomState('closed'));
    }
    async join() {
        this._worker = await (0, mediasoup_client_aiortc_1.createWorker)({
            logLevel: process.env.LOGLEVEL || 'warn'
        });
        const protooTransport = new protoo_client_1.default.WebSocketTransport(this._protooUrl);
        this._protoo = new protoo_client_1.default.Peer(protooTransport);
        store.dispatch(stateActions.setRoomState('connecting'));
        this._protoo.on('open', () => this._joinRoom());
        this._protoo.on('failed', () => {
            logger.error('WebSocket connection failed');
        });
        this._protoo.on('disconnected', () => {
            logger.error('WebSocket disconnected');
            // Close mediasoup Transports.
            if (this._sendTransport) {
                this._sendTransport.close();
                this._sendTransport = null;
            }
            if (this._recvTransport) {
                this._recvTransport.close();
                this._recvTransport = null;
            }
            store.dispatch(stateActions.setRoomState('closed'));
        });
        this._protoo.on('close', () => {
            if (this._closed)
                return;
            this.close();
        });
        // eslint-disable-next-line no-unused-vars
        this._protoo.on('request', async (request, accept, reject) => {
            logger.debug('proto "request" event [method:%s, data:%o]', request.method, request.data);
            switch (request.method) {
                case 'newConsumer':
                    {
                        if (!this._consume) {
                            reject(403, 'I do not want to consume');
                            break;
                        }
                        const { peerId, producerId, id, kind, rtpParameters, type, appData, producerPaused } = request.data;
                        try {
                            const consumer = await this._recvTransport.consume({
                                id,
                                producerId,
                                kind,
                                rtpParameters,
                                appData: { ...appData, peerId } // Trick.
                            });
                            // Store in the map.
                            this._consumers.set(consumer.id, consumer);
                            consumer.on('transportclose', () => {
                                this._consumers.delete(consumer.id);
                            });
                            const { spatialLayers, temporalLayers } = mediasoupClient.parseScalabilityMode(consumer.rtpParameters.encodings[0].scalabilityMode);
                            store.dispatch(stateActions.addConsumer({
                                id: consumer.id,
                                type: type,
                                locallyPaused: false,
                                remotelyPaused: producerPaused,
                                rtpParameters: consumer.rtpParameters,
                                spatialLayers: spatialLayers,
                                temporalLayers: temporalLayers,
                                preferredSpatialLayer: spatialLayers - 1,
                                preferredTemporalLayer: temporalLayers - 1,
                                priority: 1,
                                codec: consumer.rtpParameters.codecs[0].mimeType.split('/')[1],
                                track: consumer.track
                            }, peerId));
                            // We are ready. Answer the protoo request so the server will
                            // resume this Consumer (which was paused for now if video).
                            accept();
                            // If audio-only mode is enabled, pause it.
                            if (consumer.kind === 'video' && store.getState().me.audioOnly)
                                this._pauseConsumer(consumer);
                        }
                        catch (error) {
                            logger.error('"newConsumer" request failed:%o', error);
                            throw error;
                        }
                        break;
                    }
                case 'newDataConsumer':
                    {
                        if (!this._consume) {
                            reject(403, 'I do not want to data consume');
                            break;
                        }
                        if (!this._useDataChannel) {
                            reject(403, 'I do not want DataChannels');
                            break;
                        }
                        const { peerId, // NOTE: Null if bot.
                        dataProducerId, id, sctpStreamParameters, label, protocol, appData } = request.data;
                        try {
                            const dataConsumer = await this._recvTransport.consumeData({
                                id,
                                dataProducerId,
                                sctpStreamParameters,
                                label,
                                protocol,
                                appData: { ...appData, peerId } // Trick.
                            });
                            // Store in the map.
                            this._dataConsumers.set(dataConsumer.id, dataConsumer);
                            dataConsumer.on('transportclose', () => {
                                this._dataConsumers.delete(dataConsumer.id);
                            });
                            dataConsumer.on('open', () => {
                                logger.debug('DataConsumer "open" event');
                            });
                            dataConsumer.on('close', () => {
                                logger.warn('DataConsumer "close" event');
                                this._dataConsumers.delete(dataConsumer.id);
                            });
                            dataConsumer.on('error', (error) => {
                                logger.error('DataConsumer "error" event:%o', error);
                            });
                            dataConsumer.on('message', (message) => {
                                logger.debug('DataConsumer "message" event [streamId:%d]', dataConsumer.sctpStreamParameters.streamId);
                                if (message instanceof ArrayBuffer) {
                                    const view = new DataView(message);
                                    const number = view.getUint32(0);
                                    if (number == Math.pow(2, 32) - 1) {
                                        logger.warn('dataChannelTest finished!');
                                        this._nextDataChannelTestNumber = 0;
                                        return;
                                    }
                                    if (number > this._nextDataChannelTestNumber) {
                                        logger.warn('dataChannelTest: %s packets missing', number - this._nextDataChannelTestNumber);
                                    }
                                    this._nextDataChannelTestNumber = number + 1;
                                    return;
                                }
                                else if (typeof message !== 'string') {
                                    logger.warn('ignoring DataConsumer "message" (not a string)');
                                    return;
                                }
                                switch (dataConsumer.label) {
                                    case 'chat':
                                        {
                                            const { peers } = store.getState();
                                            const peersArray = Object.keys(peers)
                                                .map((_peerId) => peers[_peerId]);
                                            const sendingPeer = peersArray
                                                .find((peer) => peer.dataConsumers.includes(dataConsumer.id));
                                            if (!sendingPeer) {
                                                logger.warn('DataConsumer "message" from unknown peer');
                                                break;
                                            }
                                            logger.debug(`${sendingPeer.displayName} says: "${message}"`);
                                            break;
                                        }
                                    case 'bot':
                                        {
                                            logger.debug(`message from Bot: "${message}"`);
                                            break;
                                        }
                                }
                            });
                            // For the interactive terminal.
                            global.DC = dataConsumer;
                            store.dispatch(stateActions.addDataConsumer({
                                id: dataConsumer.id,
                                sctpStreamParameters: dataConsumer.sctpStreamParameters,
                                label: dataConsumer.label,
                                protocol: dataConsumer.protocol
                            }, peerId));
                            // We are ready. Answer the protoo request.
                            accept();
                        }
                        catch (error) {
                            logger.error('"newDataConsumer" request failed:%o', error);
                            throw error;
                        }
                        break;
                    }
            }
        });
        this._protoo.on('notification', (notification) => {
            logger.debug('proto "notification" event [method:%s, data:%o]', notification.method, notification.data);
            switch (notification.method) {
                case 'producerScore':
                    {
                        const { producerId, score } = notification.data;
                        store.dispatch(stateActions.setProducerScore(producerId, score));
                        break;
                    }
                case 'newPeer':
                    {
                        const peer = notification.data;
                        store.dispatch(stateActions.addPeer({ ...peer, consumers: [], dataConsumers: [] }));
                        logger.debug(`${peer.displayName} has joined the room`);
                        break;
                    }
                case 'peerClosed':
                    {
                        const { peerId } = notification.data;
                        store.dispatch(stateActions.removePeer(peerId));
                        break;
                    }
                case 'peerDisplayNameChanged':
                    {
                        const { peerId, displayName, oldDisplayName } = notification.data;
                        store.dispatch(stateActions.setPeerDisplayName(displayName, peerId));
                        logger.debug(`${oldDisplayName} is now ${displayName}`);
                        break;
                    }
                case 'consumerClosed':
                    {
                        const { consumerId } = notification.data;
                        const consumer = this._consumers.get(consumerId);
                        if (!consumer)
                            break;
                        consumer.close();
                        this._consumers.delete(consumerId);
                        const { peerId } = consumer.appData;
                        store.dispatch(stateActions.removeConsumer(consumerId, peerId));
                        break;
                    }
                case 'consumerPaused':
                    {
                        const { consumerId } = notification.data;
                        const consumer = this._consumers.get(consumerId);
                        if (!consumer)
                            break;
                        store.dispatch(stateActions.setConsumerPaused(consumerId, 'remote'));
                        break;
                    }
                case 'consumerResumed':
                    {
                        const { consumerId } = notification.data;
                        const consumer = this._consumers.get(consumerId);
                        if (!consumer)
                            break;
                        store.dispatch(stateActions.setConsumerResumed(consumerId, 'remote'));
                        break;
                    }
                case 'consumerLayersChanged':
                    {
                        const { consumerId, spatialLayer, temporalLayer } = notification.data;
                        const consumer = this._consumers.get(consumerId);
                        if (!consumer)
                            break;
                        store.dispatch(stateActions.setConsumerCurrentLayers(consumerId, spatialLayer, temporalLayer));
                        break;
                    }
                case 'consumerScore':
                    {
                        const { consumerId, score } = notification.data;
                        store.dispatch(stateActions.setConsumerScore(consumerId, score));
                        break;
                    }
                case 'dataConsumerClosed':
                    {
                        const { dataConsumerId } = notification.data;
                        const dataConsumer = this._dataConsumers.get(dataConsumerId);
                        if (!dataConsumer)
                            break;
                        dataConsumer.close();
                        this._dataConsumers.delete(dataConsumerId);
                        const { peerId } = dataConsumer.appData;
                        store.dispatch(stateActions.removeDataConsumer(dataConsumerId, peerId));
                        break;
                    }
                case 'activeSpeaker':
                    {
                        const { peerId } = notification.data;
                        store.dispatch(stateActions.setRoomActiveSpeaker(peerId));
                        break;
                    }
                default:
                    {
                        logger.error('unknown protoo notification.method "%s"', notification.method);
                    }
            }
        });
    }
    async enableMic() {
        logger.debug('enableMic()');
        if (this._micProducer)
            return;
        if (!this._mediasoupDevice.canProduce('audio')) {
            logger.error('enableMic() | cannot produce audio');
            return;
        }
        let stream;
        let track;
        try {
            if (!this._externalAudio) {
                stream = await this._worker.getUserMedia({
                    audio: { source: 'device' }
                });
            }
            else {
                stream = await this._worker.getUserMedia({
                    audio: {
                        source: this._externalAudio.startsWith('http') ? 'url' : 'file',
                        file: this._externalAudio,
                        url: this._externalAudio
                    }
                });
            }
            // TODO: For testing.
            global.audioStream = stream;
            track = stream.getAudioTracks()[0];
            this._micProducer = await this._sendTransport.produce({
                track,
                codecOptions: {
                    opusStereo: true,
                    opusDtx: true
                }
            });
            store.dispatch(stateActions.addProducer({
                id: this._micProducer.id,
                paused: this._micProducer.paused,
                track: this._micProducer.track,
                rtpParameters: this._micProducer.rtpParameters,
                codec: this._micProducer.rtpParameters.codecs[0].mimeType.split('/')[1]
            }));
            this._micProducer.on('transportclose', () => {
                this._micProducer = null;
            });
            this._micProducer.on('trackended', () => {
                logger.error('Microphone disconnected!');
                this.disableMic()
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    .catch(() => { });
            });
        }
        catch (error) {
            logger.error('enableMic() | failed:%o', error);
            if (track)
                track.stop();
        }
    }
    async disableMic() {
        logger.debug('disableMic()');
        if (!this._micProducer)
            return;
        this._micProducer.close();
        store.dispatch(stateActions.removeProducer(this._micProducer.id));
        try {
            await this._protoo.request('closeProducer', { producerId: this._micProducer.id });
        }
        catch (error) {
            logger.error(`Error closing server-side mic Producer: ${error}`);
        }
        this._micProducer = null;
    }
    async muteMic() {
        logger.debug('muteMic()');
        this._micProducer.pause();
        try {
            await this._protoo.request('pauseProducer', { producerId: this._micProducer.id });
            store.dispatch(stateActions.setProducerPaused(this._micProducer.id));
        }
        catch (error) {
            logger.error('muteMic() | failed: %o', error);
        }
    }
    async unmuteMic() {
        logger.debug('unmuteMic()');
        this._micProducer.resume();
        try {
            await this._protoo.request('resumeProducer', { producerId: this._micProducer.id });
            store.dispatch(stateActions.setProducerResumed(this._micProducer.id));
        }
        catch (error) {
            logger.error('unmuteMic() | failed: %o', error);
        }
    }
    async enableWebcam() {
        logger.debug('enableWebcam()');
        if (this._webcamProducer)
            return;
        if (!this._mediasoupDevice.canProduce('video')) {
            logger.error('enableWebcam() | cannot produce video');
            return;
        }
        store.dispatch(stateActions.setWebcamInProgress(true));
        let stream;
        let track;
        try {
            if (!this._externalVideo) {
                stream = await this._worker.getUserMedia({
                    video: { source: 'device' }
                });
            }
            else {
                stream = await this._worker.getUserMedia({
                    video: {
                        source: this._externalVideo.startsWith('http') ? 'url' : 'file',
                        file: this._externalVideo,
                        url: this._externalVideo
                    }
                });
            }
            // TODO: For testing.
            global.videoStream = stream;
            track = stream.getVideoTracks()[0];
            this._webcamProducer = await this._sendTransport.produce({ track });
            // TODO.
            const device = {
                label: 'rear-xyz'
            };
            store.dispatch(stateActions.addProducer({
                id: this._webcamProducer.id,
                deviceLabel: device.label,
                type: this._getWebcamType(device),
                paused: this._webcamProducer.paused,
                track: this._webcamProducer.track,
                rtpParameters: this._webcamProducer.rtpParameters,
                codec: this._webcamProducer.rtpParameters.codecs[0].mimeType.split('/')[1]
            }));
            this._webcamProducer.on('transportclose', () => {
                this._webcamProducer = null;
            });
            this._webcamProducer.on('trackended', () => {
                logger.error('Webcam disconnected!');
                this.disableWebcam()
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    .catch(() => { });
            });
        }
        catch (error) {
            logger.error('enableWebcam() | failed:%o', error);
            logger.error('enabling Webcam!');
            if (track)
                track.stop();
        }
        store.dispatch(stateActions.setWebcamInProgress(false));
    }
    async disableWebcam() {
        logger.debug('disableWebcam()');
        if (!this._webcamProducer)
            return;
        this._webcamProducer.close();
        store.dispatch(stateActions.removeProducer(this._webcamProducer.id));
        try {
            await this._protoo.request('closeProducer', { producerId: this._webcamProducer.id });
        }
        catch (error) {
            logger.error(`Error closing server-side webcam Producer: ${error}`);
        }
        this._webcamProducer = null;
    }
    async muteWebcam() {
        logger.debug('muteWebcam()');
        try {
            this._webcamProducer.pause();
            await this._protoo.request('pauseProducer', { producerId: this._webcamProducer.id });
            store.dispatch(stateActions.setProducerPaused(this._webcamProducer.id));
        }
        catch (error) {
            logger.error('muteWebcam() | failed: %o', error);
        }
    }
    async unmuteWebcam() {
        logger.debug('unmuteWebcam()');
        try {
            this._webcamProducer.resume();
            await this._protoo.request('resumeProducer', { producerId: this._webcamProducer.id });
            store.dispatch(stateActions.setProducerResumed(this._webcamProducer.id));
        }
        catch (error) {
            logger.error('unmuteWebcam() | failed: %o', error);
        }
    }
    async changeWebcam() {
        logger.debug('changeWebcam()');
        if (!this._webcamProducer)
            throw new Error('webcam not enabled');
        store.dispatch(stateActions.setWebcamInProgress(true));
        let stream;
        let track;
        try {
            if (!this._externalVideo) {
                stream = await this._worker.getUserMedia({
                    video: { source: 'device' }
                });
            }
            else {
                stream = await this._worker.getUserMedia({
                    video: {
                        source: this._externalVideo.startsWith('http') ? 'url' : 'file',
                        file: this._externalVideo,
                        url: this._externalVideo
                    }
                });
            }
            // TODO: For testing.
            global.videoStream = stream;
            track = stream.getVideoTracks()[0];
            await this._webcamProducer.replaceTrack({ track });
            store.dispatch(stateActions.setProducerTrack(this._webcamProducer.id, track));
            this._webcamProducer.on('transportclose', () => {
                this._webcamProducer = null;
            });
            this._webcamProducer.on('trackended', () => {
                logger.error('Webcam disconnected!');
                this.disableWebcam()
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    .catch(() => { });
            });
        }
        catch (error) {
            logger.error('changeWebcam() | failed:%o', error);
            logger.error('enabling Webcam!');
            if (track)
                track.stop();
        }
        store.dispatch(stateActions.setWebcamInProgress(false));
    }
    async enableAudioOnly() {
        logger.debug('enableAudioOnly()');
        store.dispatch(stateActions.setAudioOnlyInProgress(true));
        this.disableWebcam();
        for (const consumer of this._consumers.values()) {
            if (consumer.kind !== 'video')
                continue;
            this._pauseConsumer(consumer);
        }
        store.dispatch(stateActions.setAudioOnlyState(true));
        store.dispatch(stateActions.setAudioOnlyInProgress(false));
    }
    async disableAudioOnly() {
        logger.debug('disableAudioOnly()');
        store.dispatch(stateActions.setAudioOnlyInProgress(true));
        if (!this._webcamProducer &&
            this._produce) {
            this.enableWebcam();
        }
        for (const consumer of this._consumers.values()) {
            if (consumer.kind !== 'video')
                continue;
            this._resumeConsumer(consumer);
        }
        store.dispatch(stateActions.setAudioOnlyState(false));
        store.dispatch(stateActions.setAudioOnlyInProgress(false));
    }
    async muteAudio() {
        logger.debug('muteAudio()');
        store.dispatch(stateActions.setAudioMutedState(true));
    }
    async unmuteAudio() {
        logger.debug('unmuteAudio()');
        store.dispatch(stateActions.setAudioMutedState(false));
    }
    async restartIce() {
        logger.debug('restartIce()');
        store.dispatch(stateActions.setRestartIceInProgress(true));
        try {
            if (this._sendTransport) {
                const iceParameters = await this._protoo.request('restartIce', { transportId: this._sendTransport.id });
                await this._sendTransport.restartIce({ iceParameters });
            }
            if (this._recvTransport) {
                const iceParameters = await this._protoo.request('restartIce', { transportId: this._recvTransport.id });
                await this._recvTransport.restartIce({ iceParameters });
            }
            logger.debug('ICE restarted');
        }
        catch (error) {
            logger.error('restartIce() | failed:%o', error);
        }
        store.dispatch(stateActions.setRestartIceInProgress(false));
    }
    async setConsumerPriority(consumerId, priority) {
        logger.debug('setConsumerPriority() [consumerId:%s, priority:%d]', consumerId, priority);
        try {
            await this._protoo.request('setConsumerPriority', { consumerId, priority });
            store.dispatch(stateActions.setConsumerPriority(consumerId, priority));
        }
        catch (error) {
            logger.error('setConsumerPriority() | failed:%o', error);
        }
    }
    async requestConsumerKeyFrame(consumerId) {
        logger.debug('requestConsumerKeyFrame() [consumerId:%s]', consumerId);
        try {
            await this._protoo.request('requestConsumerKeyFrame', { consumerId });
            logger.debug('Keyframe requested for video consumer');
        }
        catch (error) {
            logger.error('requestConsumerKeyFrame() | failed:%o', error);
        }
    }
    async enableChatDataProducer() {
        logger.debug('enableChatDataProducer()');
        if (!this._useDataChannel)
            return;
        // NOTE: Should enable this code but it's useful for testing.
        // if (this._chatDataProducer)
        // 	return;
        try {
            // Create chat DataProducer.
            this._chatDataProducer = await this._sendTransport.produceData({
                ordered: false,
                maxRetransmits: 1,
                label: 'chat',
                // priority       : 'medium',
                appData: { info: 'my-chat-DataProducer' }
            });
            store.dispatch(stateActions.addDataProducer({
                id: this._chatDataProducer.id,
                sctpStreamParameters: this._chatDataProducer.sctpStreamParameters,
                label: this._chatDataProducer.label,
                protocol: this._chatDataProducer.protocol
            }));
            this._chatDataProducer.on('transportclose', () => {
                this._chatDataProducer = null;
            });
            this._chatDataProducer.on('open', () => {
                logger.debug('chat DataProducer "open" event');
            });
            this._chatDataProducer.on('close', () => {
                logger.error('chat DataProducer "close" event');
                this._chatDataProducer = null;
            });
            this._chatDataProducer.on('error', (error) => {
                logger.error('chat DataProducer "error" event:%o', error);
            });
            this._chatDataProducer.on('bufferedamountlow', () => {
                logger.debug('chat DataProducer "bufferedamountlow" event');
            });
        }
        catch (error) {
            logger.error('enableChatDataProducer() | failed:%o', error);
            throw error;
        }
    }
    async enableBotDataProducer() {
        logger.debug('enableBotDataProducer()');
        if (!this._useDataChannel)
            return;
        // NOTE: Should enable this code but it's useful for testing.
        // if (this._botDataProducer)
        // 	return;
        try {
            // Create chat DataProducer.
            this._botDataProducer = await this._sendTransport.produceData({
                ordered: false,
                maxPacketLifeTime: 2000,
                label: 'bot',
                // priority          : 'medium',
                appData: { info: 'my-bot-DataProducer' }
            });
            store.dispatch(stateActions.addDataProducer({
                id: this._botDataProducer.id,
                sctpStreamParameters: this._botDataProducer.sctpStreamParameters,
                label: this._botDataProducer.label,
                protocol: this._botDataProducer.protocol
            }));
            this._botDataProducer.on('transportclose', () => {
                this._botDataProducer = null;
            });
            this._botDataProducer.on('open', () => {
                logger.debug('bot DataProducer "open" event');
            });
            this._botDataProducer.on('close', () => {
                logger.error('bot DataProducer "close" event');
                this._botDataProducer = null;
            });
            this._botDataProducer.on('error', (error) => {
                logger.error('bot DataProducer "error" event:%o', error);
            });
            this._botDataProducer.on('bufferedamountlow', () => {
                logger.debug('bot DataProducer "bufferedamountlow" event');
            });
        }
        catch (error) {
            logger.error('enableBotDataProducer() | failed:%o', error);
            throw error;
        }
    }
    async sendChatMessage(text) {
        logger.debug('sendChatMessage() [text:"%s]', text);
        if (!this._chatDataProducer) {
            logger.error('No chat DataProducer');
            return;
        }
        try {
            this._chatDataProducer.send(text);
        }
        catch (error) {
            logger.error('chat DataProducer.send() failed:%o', error);
        }
    }
    async sendBotMessage(text) {
        logger.debug('sendBotMessage() [text:"%s]', text);
        if (!this._botDataProducer) {
            logger.error('No bot DataProducer');
            return;
        }
        try {
            this._botDataProducer.send(text);
        }
        catch (error) {
            logger.error('bot DataProducer.send() failed:%o', error);
        }
    }
    async changeDisplayName(displayName) {
        logger.debug('changeDisplayName() [displayName:"%s"]', displayName);
        const previousDisplayName = this._displayName;
        try {
            await this._protoo.request('changeDisplayName', { displayName });
            this._displayName = displayName;
            logger.debug('Display name changed');
            store.dispatch(stateActions.setDisplayName(displayName));
        }
        catch (error) {
            logger.error('changeDisplayName() | failed: %o', error);
            // We need to refresh the component for it to render the previous
            // displayName again.
            store.dispatch(stateActions.setDisplayName(previousDisplayName));
        }
    }
    async getSendTransportRemoteStats() {
        logger.debug('getSendTransportRemoteStats()');
        if (!this._sendTransport)
            return;
        return this._protoo.request('getTransportStats', { transportId: this._sendTransport.id });
    }
    async getRecvTransportRemoteStats() {
        logger.debug('getRecvTransportRemoteStats()');
        if (!this._recvTransport)
            return;
        return this._protoo.request('getTransportStats', { transportId: this._recvTransport.id });
    }
    async getAudioRemoteStats() {
        logger.debug('getAudioRemoteStats()');
        if (!this._micProducer)
            return;
        return this._protoo.request('getProducerStats', { producerId: this._micProducer.id });
    }
    async getVideoRemoteStats() {
        logger.debug('getVideoRemoteStats()');
        const producer = this._webcamProducer || this._shareProducer;
        if (!producer)
            return;
        return this._protoo.request('getProducerStats', { producerId: producer.id });
    }
    async getConsumerRemoteStats(consumerId) {
        logger.debug('getConsumerRemoteStats()');
        const consumer = this._consumers.get(consumerId);
        if (!consumer)
            return;
        return this._protoo.request('getConsumerStats', { consumerId });
    }
    async getChatDataProducerRemoteStats() {
        logger.debug('getChatDataProducerRemoteStats()');
        const dataProducer = this._chatDataProducer;
        if (!dataProducer)
            return;
        return this._protoo.request('getDataProducerStats', { dataProducerId: dataProducer.id });
    }
    async getBotDataProducerRemoteStats() {
        logger.debug('getBotDataProducerRemoteStats()');
        const dataProducer = this._botDataProducer;
        if (!dataProducer)
            return;
        return this._protoo.request('getDataProducerStats', { dataProducerId: dataProducer.id });
    }
    async getDataConsumerRemoteStats(dataConsumerId) {
        logger.debug('getDataConsumerRemoteStats()');
        const dataConsumer = this._dataConsumers.get(dataConsumerId);
        if (!dataConsumer)
            return;
        return this._protoo.request('getDataConsumerStats', { dataConsumerId });
    }
    async getSendTransportLocalStats() {
        logger.debug('getSendTransportLocalStats()');
        if (!this._sendTransport)
            return undefined;
        return this._sendTransport.getStats();
    }
    async getRecvTransportLocalStats() {
        logger.debug('getRecvTransportLocalStats()');
        if (!this._recvTransport)
            return undefined;
        return this._recvTransport.getStats();
    }
    async getAudioLocalStats() {
        logger.debug('getAudioLocalStats()');
        if (!this._micProducer)
            return;
        return this._micProducer.getStats();
    }
    async getVideoLocalStats() {
        logger.debug('getVideoLocalStats()');
        const producer = this._webcamProducer || this._shareProducer;
        if (!producer)
            return;
        return producer.getStats();
    }
    async getConsumerLocalStats(consumerId) {
        const consumer = this._consumers.get(consumerId);
        if (!consumer)
            return;
        return consumer.getStats();
    }
    async showLocalStats() {
        logger.debug('showLocalStats()');
        const sendTransportStats = await this.getSendTransportLocalStats();
        const recvTransportStats = await this.getRecvTransportLocalStats();
        const audioStats = await this.getAudioLocalStats();
        const videoStats = await this.getVideoLocalStats();
        const stats = {
            sendTransport: sendTransportStats
                ? Array.from(sendTransportStats.values())
                : undefined,
            recvTransport: recvTransportStats
                ? Array.from(recvTransportStats.values())
                : undefined,
            audio: audioStats
                ? Array.from(audioStats.values())
                : undefined,
            video: videoStats
                ? Array.from(videoStats.values())
                : undefined
        };
        clearInterval(this._localStatsPeriodicTimer);
        this._localStatsPeriodicTimer = setInterval(() => {
            logger.debug('local stats:');
            logger.debug(JSON.stringify(stats, null, '  '));
        }, 2500);
    }
    async hideLocalStats() {
        logger.debug('hideLocalStats()');
        clearInterval(this._localStatsPeriodicTimer);
    }
    async _joinRoom() {
        logger.debug('_joinRoom()');
        try {
            this._mediasoupDevice = new mediasoupClient.Device({
                handlerFactory: this._worker.createHandlerFactory()
            });
            const routerRtpCapabilities = await this._protoo.request('getRouterRtpCapabilities');
            await this._mediasoupDevice.load({ routerRtpCapabilities });
            // Create mediasoup Transport for sending (unless we don't want to produce).
            if (this._produce) {
                const transportInfo = await this._protoo.request('createWebRtcTransport', {
                    forceTcp: this._forceTcp,
                    producing: true,
                    consuming: false,
                    sctpCapabilities: this._useDataChannel
                        ? this._mediasoupDevice.sctpCapabilities
                        : undefined
                });
                const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters } = transportInfo;
                this._sendTransport = this._mediasoupDevice.createSendTransport({
                    id,
                    iceParameters,
                    iceCandidates,
                    dtlsParameters,
                    sctpParameters,
                    iceServers: [],
                    proprietaryConstraints: PC_PROPRIETARY_CONSTRAINTS
                });
                this._sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => // eslint-disable-line no-shadow
                 {
                    this._protoo.request('connectWebRtcTransport', {
                        transportId: this._sendTransport.id,
                        dtlsParameters
                    })
                        .then(callback)
                        .catch(errback);
                });
                this._sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                    try {
                        // eslint-disable-next-line no-shadow
                        const { id } = await this._protoo.request('produce', {
                            transportId: this._sendTransport.id,
                            kind,
                            rtpParameters,
                            appData
                        });
                        callback({ id });
                    }
                    catch (error) {
                        errback(error);
                    }
                });
                this._sendTransport.on('producedata', async ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
                    logger.debug('"producedata" event: [sctpStreamParameters:%o, appData:%o]', sctpStreamParameters, appData);
                    try {
                        // eslint-disable-next-line no-shadow
                        const { id } = await this._protoo.request('produceData', {
                            transportId: this._sendTransport.id,
                            sctpStreamParameters,
                            label,
                            protocol,
                            appData
                        });
                        callback({ id });
                    }
                    catch (error) {
                        errback(error);
                    }
                });
            }
            // Create mediasoup Transport for sending (unless we don't want to consume).
            if (this._consume) {
                const transportInfo = await this._protoo.request('createWebRtcTransport', {
                    forceTcp: this._forceTcp,
                    producing: false,
                    consuming: true,
                    sctpCapabilities: this._useDataChannel
                        ? this._mediasoupDevice.sctpCapabilities
                        : undefined
                });
                const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters } = transportInfo;
                this._recvTransport = this._mediasoupDevice.createRecvTransport({
                    id,
                    iceParameters,
                    iceCandidates,
                    dtlsParameters,
                    sctpParameters,
                    iceServers: []
                });
                this._recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => // eslint-disable-line no-shadow
                 {
                    this._protoo.request('connectWebRtcTransport', {
                        transportId: this._recvTransport.id,
                        dtlsParameters
                    })
                        .then(callback)
                        .catch(errback);
                });
            }
            // Join now into the room.
            // NOTE: Don't send our RTP capabilities if we don't want to consume.
            const { peers } = await this._protoo.request('join', {
                displayName: this._displayName,
                device: this._device,
                rtpCapabilities: this._consume
                    ? this._mediasoupDevice.rtpCapabilities
                    : undefined,
                sctpCapabilities: this._useDataChannel && this._consume
                    ? this._mediasoupDevice.sctpCapabilities
                    : undefined
            });
            store.dispatch(stateActions.setRoomState('connected'));
            // Clean all the existing notifcations.
            store.dispatch(stateActions.removeAllNotifications());
            logger.debug('You are in the room!');
            for (const peer of peers) {
                store.dispatch(stateActions.addPeer({ ...peer, consumers: [], dataConsumers: [] }));
            }
            // Enable mic/webcam.
            if (this._produce) {
                // Set our media capabilities.
                store.dispatch(stateActions.setMediaCapabilities({
                    canSendMic: this._mediasoupDevice.canProduce('audio'),
                    canSendWebcam: this._mediasoupDevice.canProduce('video')
                }));
                this.enableMic();
                this.enableWebcam();
                this._sendTransport.on('connectionstatechange', (connectionState) => {
                    if (connectionState === 'connected') {
                        this.enableChatDataProducer();
                        this.enableBotDataProducer();
                    }
                });
            }
        }
        catch (error) {
            logger.error('_joinRoom() failed:%o', error);
            this.close();
        }
    }
    _getWebcamType(device) {
        if (/(back|rear)/i.test(device.label)) {
            logger.debug('_getWebcamType() | it seems to be a back camera');
            return 'back';
        }
        else {
            logger.debug('_getWebcamType() | it seems to be a front camera');
            return 'front';
        }
    }
    async _pauseConsumer(consumer) {
        if (consumer.paused)
            return;
        try {
            await this._protoo.request('pauseConsumer', { consumerId: consumer.id });
            consumer.pause();
            store.dispatch(stateActions.setConsumerPaused(consumer.id, 'local'));
        }
        catch (error) {
            logger.error('_pauseConsumer() | failed:%o', error);
        }
    }
    async _resumeConsumer(consumer) {
        if (!consumer.paused)
            return;
        try {
            await this._protoo.request('resumeConsumer', { consumerId: consumer.id });
            consumer.resume();
            store.dispatch(stateActions.setConsumerResumed(consumer.id, 'local'));
        }
        catch (error) {
            logger.error('_resumeConsumer() | failed:%o', error);
        }
    }
}
exports.RoomClient = RoomClient;
