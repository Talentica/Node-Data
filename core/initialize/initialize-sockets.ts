﻿import {MetaUtils} from "../metadata/utils";
import * as Utils from "../utils";
import * as mongooseUtils from '../../mongoose/utils';
import {MetaData} from '../metadata/metadata';
import {ExportTypes} from '../constants/decorators';
import {IDynamicRepository, DynamicRepository} from '../dynamic/dynamic-repository';
import {InstanceService} from '../services/instance-service';
import {ParamTypeCustom} from '../metadata/param-type-custom';
import {searchUtils} from "../../search/elasticSearchUtils";
//var Config = Utils.config();
import {Decorators} from '../constants';

import {IRepositoryParams} from '../decorators/interfaces';
import {repositoryMap} from '../exports/repositories';

import {ISchemaGenerator} from '../interfaces/schema-generator';
import * as Enumerable from 'linq';
import {repoFromModel} from '../dynamic/model-entity';

export var mongooseNameSchemaMap: { [key: string]: any } = {};

import * as securityImpl from '../dynamic/security-impl';
var domain = require('domain');
import {inject} from '../../di/decorators/inject';

import {Messenger} from '../../mongoose/pubsub/messenger';
import {PrincipalContext} from '../../security/auth/principalContext';
import {Session} from  '../../models/session';
import * as configUtils from '../utils';
import {repoMap} from './initialize-repositories';
import {getQueryOptionsFromQuery} from '../interfaces/queryOptions';
import * as Q from 'q';
const uuidv4 = require('uuid/v4');
import {IWorkerProcessService} from "../services/workerProcessService";
import {IWorkerProcess} from "../../models/IWorkerProcess";
import {IAutherizationParam} from "../../security/auth/autherizationParam";
import {allAutherizationRules, allAutherizationRulesMap, workerProcessService, mainMessenger, channleMessangerMap} from "./initialize-messengers";
export var messageBraodcastOnMessenger: (repo: IDynamicRepository, message: any,collection?:any) => void;
export var socketConnector: () => void;
export class InitializeScokets {



    private _schemaGenerator: ISchemaGenerator;
    private socketClientholder: { socket: any, clients: Array<any>, messenger: any } = { socket: {}, clients: [], messenger: {} };
    private socketChannelGroups: any = {}; // key is channel name and values array of groups
    private sessionSocketIdMap = {}; //need to be handled the disconnection {userId}.{socket.id}:true
    private socket: any;


    private io:any = undefined;
    

    private serverId = uuidv4();
    // name.role :{ role: string, accessmask: number, acl?: boolean }

    constructor(server?: any) {

        allAutherizationRules.forEach((rule) => {
            this.socketChannelGroups[rule.name] = {};
        });

        this.initializeSocketServer(server);
    }
    public schemaGenerator(schemaGenerator: ISchemaGenerator) {
        this._schemaGenerator = schemaGenerator;
    }


    private checkIfRepoForMessenger = (meta: MetaData): boolean =>
        meta && (meta.params.exportType == ExportTypes.ALL ||
            (this.io && (((meta.params.exportType & ExportTypes.WS) == ExportTypes.WS) ||
                ((meta.params.exportType & ExportTypes.WS_BROAD_CAST) == ExportTypes.WS_BROAD_CAST) ||
                ((meta.params.exportType & ExportTypes.PUB_SUB) == ExportTypes.PUB_SUB)))
        )


    private initializeSocketServer(server?: any) {
        let self = this;



        let io:any = self.io;
        

        this.socketClientholder.socket = io;


        let joinNormalChannels = (socket):any => {
            let session = socket.handshake.query.curSession;
            if (!session.userId) { return; }
            if (!self.sessionSocketIdMap[session.userId]) { self.sessionSocketIdMap[session.userId] = {}; }
            self.sessionSocketIdMap[session.userId][socket.id] = true;
            if (socket.handshake.query && socket.handshake.query.applicableChannels
                && socket.handshake.query.applicableChannels.length) {
                socket.handshake.query.applicableChannels.forEach((room) => {
                    if (room && room.name) {
                        if (!self.socketChannelGroups[room.name]) { self.socketChannelGroups[room.name] = {}; }
                       
                    }
                });
            }
            if (socket.handshake.query && socket.handshake.query.channels) {
                let channelArr: Array<string> = socket.handshake.query.channels.split(",");
                if (channelArr && channelArr.length) {
                    channelArr.forEach((room) => {
                        //console.log("joined room ", room);
                        socket.join(room);
                    });
                }
            }
            return socket;
            
        }

        let joinRealiableChannels = (socket) => {
            if (socket.handshake.query && socket.handshake.query.broadcastChannels
                && socket.handshake.query.broadcastChannels.length) {
                socket.handshake.query.broadcastChannels.forEach((room) => {
                    if (room && room.name && room.group) {
                        if (socket.handshake.query && socket.handshake.query.reliableChannles) {
                            let channelArr: Array<string> = socket.handshake.query.reliableChannles.split(",");
                            if (channelArr.indexOf(room.name) > -1) {
                                //console.log("joined room group with reliable session", room.name + "_" + room.group + "_RC");
                                socket.join(room.name + "_" + room.group + "_RC");
                                if (!self.socketChannelGroups[room.name][room.group + "_RC"]) { self.socketChannelGroups[room.name][room.group + "_RC"] = true }
                                return;
                            }
                        }
                        //console.log("joined room group", room.name + "_" + room.group);
                        if (!self.socketChannelGroups[room.name][room.group]) { self.socketChannelGroups[room.name][room.group] = false }
                        socket.join(room.name + "_" + room.group);
                    }
                    else if (room) {
                        //console.log("joined room ", room);
                        socket.join(room);
                    }
                });
            }
            return socket;
        }

        let createWorkerOnConnect = (socket) => {
            let session = socket.handshake.query.curSession;
            if (socket.handshake.query && socket.handshake.query.reliableChannles) {
                var Config = Utils.config();
                if (Config.Path && Config.Path.ackChannelName) {
                    socket.on(Config.Path.ackChannelName, function (data) {
                        //console.log("acknowledgement recieved", data);
                        // update last ask in session
                        securityImpl.updateSession({
                            netsessionid: socket.handshake.query.netsessionid,
                            channelName: data.message.channel,
                            lastack: new Date(data.message.timestamp),
                        }, session);
                    })
                }
                let channelArr: Array<string> = socket.handshake.query.reliableChannles.split(",");
                if (channelArr && channelArr.length) {
                    let newWorker: IWorkerProcess = {
                        serverId: self.serverId, workerId: socket.id,
                        status: "connected", channels: channelArr, sessionId: session.sessionId, role: session.role
                    };
                    workerProcessService.createWorker(newWorker);
                }
            }
            return socket;
        }

        let sendPendingMesagesOnConnect = (socket) => {
            if (socket.handshake.query && socket.handshake.query.reliableChannles) {
                let channelArr: Array<string> = socket.handshake.query.reliableChannles.split(",");

                channelArr.forEach((rechannel) => {

                    if (socket.handshake.query.isAckRequired === "true" || socket.handshake.query.isAckRequired === true) {
                        securityImpl.getSessionLastAckForChannel(socket.handshake.query, rechannel).then((lastack) => {
                            if (lastack && channleMessangerMap && channleMessangerMap[rechannel]) {
                                //for each chnnel ask messeger the send an array of pending message

                                channleMessangerMap[rechannel].sendPendingMessage(rechannel, lastack, socket.id);

                                //use socket.emitt to send previous message
                            }
                        }).catch((error) => {
                            console.log("error in securityImpl.getSessionLastAckForChannel", error);
                        });
                    }
                    else {
                        securityImpl.getSessionLastTimeStampForChannel(socket.handshake.query, rechannel).then((lastemit) => {
                            if (lastemit && channleMessangerMap && channleMessangerMap[rechannel]) {
                                //for each chnnel ask messeger the send an array of pending message

                                channleMessangerMap[rechannel].sendPendingMessage(rechannel, lastemit, socket.id);

                                //use socket.emitt to send previous message
                            }
                        }).catch((error) => {
                            console.log("error in securityImpl.getSessionLastTimeStampForChannel", error);
                        });
                    }
                }
                )
            }
            return socket;
        }

        let updateWorkerService = (socket) => {
            if (socket.handshake.query && socket.handshake.query.reliableChannles) {
                let channelArr: Array<string> = socket.handshake.query.reliableChannles.split(",");
                if (channelArr && channelArr.length) {
                    let newWorker: IWorkerProcess = { serverId: self.serverId, workerId: socket.id, status: "disconnected", channels: channelArr };
                    workerProcessService.updateWorker(newWorker);
                }
            }
            return socket;
        }
        let updateSocketServer = (socket) => {
            if (socket.handshake.query.curSession && socket.handshake.query.curSession.userId) {
                let userId = socket.handshake.query.curSession.userId;
                delete self.sessionSocketIdMap[userId][socket.id];
                if (Object.keys(self.sessionSocketIdMap[userId]).length == 0) {
                    delete self.sessionSocketIdMap[userId];
                }

            }
            return socket;
        }

        //const compose = (...fns) => fns.reduce((f, g) => (...args) => f(g(...args)))
        const compose = (...functions) => data =>
            functions.reduce((value, func) => func(value), data)
        //const compose = (...functions) => data =>
        //    functions.reduceRight((value, func) => func(value), data)

        let onSocketConnection = (socket) => { sendPendingMesagesOnConnect(createWorkerOnConnect(joinRealiableChannels(joinNormalChannels(socket)))) };
        //let onSocketConnection = (socket) => compose(joinNormalChannels , joinRealiableChannels , createWorkerOnConnect , sendPendingMesagesOnConnect)

        //let onSocketDisConnection = (socket) => compose(updateWorkerService , updateSocketServer)
        let onSocketDisConnection = (socket) => { updateWorkerService(updateSocketServer(socket)) }

        let arrOfReadAction = ["findAll", "findWhere", "countWhere", "distinctWhere", "findOne","searchAll","count"];
        let executefun = (parsedData, repo,socket) => {
            try {
                if (parsedData && parsedData.action && parsedData.message) {
                    if (securityImpl.isAuthorize(parsedData, repo, parsedData.action)) {
                        let resultpromise: any;
                        if (parsedData.action == "searchAll") {
                            parsedData.action = "findWhere";
                        }
                        if (parsedData.action == "count") {
                            parsedData.action = "countWhere";
                        }
                        if (parsedData.action == "findWhere" || parsedData.action == "countWhere") {
                            let resultquerydata = getQueryOptionsFromQuery(parsedData.message);
                            resultpromise = repo[parsedData.action](resultquerydata.queryObj, null, resultquerydata.options);
                        } else {
                             resultpromise = repo[parsedData.action](parsedData.message);
                        }
                        
                        if (arrOfReadAction.indexOf(parsedData.action) > -1) {
                            resultpromise.then((result) => socket.emit(repo.modelName(), result));
                        }
                    }
                }
            } catch (exceptio) {
                //console.log(exceptio);
            }
        };

        let onRepoMessageReceoved1 =  (socket,data,repo)=> {
            var d = domain.create();
            d.run(() => {
                

                    //check if current session can be used
                    if (data && data.headers && data.headers.netsessionid &&
                        socket.handshake.query.curSession && socket.handshake.query.curSession.sessionId && 
                        data.headers.netsessionid == socket.handshake.query.curSession.sessionId) {
                        PrincipalContext.User = securityImpl.getContextObjectFromSession(socket.handshake.query.curSession);
                        executefun(data, repo,socket);
                        return
                    }
                    (<any>(securityImpl.ensureLoggedIn()(data, undefined, executefun))).catch((err) => { console.log(err); });
                
            });
        };

        let socketConector = () => {
            if (!io && server) {
                    self.io = require('socket.io')(server, { 'transports': ['websocket', 'polling'] });
                    io = self.io;
            }

            if (!io) { return;}
            io.on('connection',
                function (socket) {
                    // this.socketClientholder.clients.push(client);
                    //console.log('client connected', socket.id);
                    if (socket.handshake.query) {
                        securityImpl.getSession(socket.handshake.query).then((session: Session) => {
                            socket.handshake.query.curSession = session;

                            onSocketConnection(socket);

                        }).catch((error) => {
                            //console.log("error in getSession", error);
                        });
                    }

                    //emitt pending messages 
                    //fetch last timestam of client for each reliable channel
                    


                    socket.on('disconnect', function () {
                        //console.log('client disconnected', socket.id);
                        onSocketDisConnection(socket);
                    });

                    for (let key in repoMap) {
                        let repo = repoMap[key].repo;
                        let meta: MetaData = repo.getMetaData();
                        if (meta && ((meta.params.exportType & ExportTypes.WS) == ExportTypes.WS)) {
                             socket.on(key, function (data, callback) {
                                if (callback) {
                                    callback("success");
                                }
                                onRepoMessageReceoved1(socket, data, repo);
                            })
                               
                        }

                    }
                   
                }
            )
        }
        socketConnector = socketConector;

        let messageOnMessenger = (repo: IDynamicRepository, message: any,collection?:any) =>
        {

            let key = repo.modelName();
            let messenger:Messenger = repo.getMessanger();

            let meta: MetaData = repo.getMetaData();

            if (!messenger) {
                return;
            }
            //console.log("message received on ", key);

            if ((meta.params.exportType & ExportTypes.PUB_SUB) == ExportTypes.PUB_SUB) {
                // messenger.sendMessageOnRepo(repo, message);
                if (collection && collection.length) {
                    collection.forEach((msg) => {
                        messenger.sendMessageOnRepo(repo, msg);
                    });
                } else {
                    messenger.sendMessageOnRepo(repo, message);
                }
            }

            if (!io) {
                return;
            }
            //handle if repo is completly broadcast
            let broadcastToAll = (castType: string) => {
                let channelRoom:any = io.sockets.adapter.rooms[key];
                if (channelRoom) {
                    var roomclients = channelRoom.length;

                    //io.sockets.emit(key, message);
                    io.to(key).emit(key, message);
                    //io.broadcast.to(key).emit(key, message);

                    console.log("WS_BROAD_CAST", { "channel": key, "no_of_broadcasts": roomclients });
                }
            }

            if (meta.params.broadCastType && meta.params.broadCastType == ExportTypes.WS_BROAD_CAST) {

                broadcastToAll("WS_BROAD_CAST");
                // io.to(key).emit(message);
                return;
            }
            // io.in(key).emit(key, message);
            //NO aACL define 
            if (!allAutherizationRulesMap[key]) {
                broadcastToAll("BROAD_CAST_NO_RULE");
                return;
            }

            let messageSendStatistics: any = {};
            let connectedClients = 0;
            let broadCastClients = 0;
            let reliableClients = 0;
            let individualClients = 0;
            let singelEmittClients = 0;


            //handle broad cast group ..acl ==false

            if (!self.socketChannelGroups[key]) {
                return;
            }

            let updateReliableChannelSettings = (client) => {
                if (!client) { return; }
                if (!client.handshake) { return; }
                if (!client.handshake.query) { return; }
                if (!client.handshake.query.curSession) { return; }
                reliableClients++;
                let query = client.handshake.query;
                let curSession = client.handshake.query.curSession;
                console.log("updating session timstamp for ", query && query.name);
                securityImpl.updateSession({
                    netsessionid: query.netsessionid,
                    channelName: key,
                    lastemit: messenger.lastMessageTimestamp,
                    status: 'active'
                }, curSession);
            }

            for (let channleGroup in self.socketChannelGroups[key]) {
                let isRealiableChannel = false;
                let groupName = key + "_" + channleGroup; //channleGroup is {role} , {role_RC} , key is repo name matchedorder_ROLE_ADMIN
                if (self.socketChannelGroups[key][channleGroup]) {
                    isRealiableChannel = self.socketChannelGroups[key][channleGroup];
                    //groupName += "_RC";


                }


                let channelRoom = io.sockets.adapter.rooms[groupName];
                if (!channelRoom) {
                    continue;
                }
                var roomclients = channelRoom.sockets;


                let broadcastClients: Array<any> = new Array<any>();


                let addAllclientsInRoom = () => {
                    if (isRealiableChannel &&
                        message.singleWorkerOnRole) {
                        return;
                    }

                    for (let channelId in roomclients) {


                        if (message.receiver && message.receiver != channelId) {
                            continue;
                        }

                        if (message.receiver) {
                            delete message.receiver;
                        }


                        let client = io.sockets.connected[channelId];
                        if (!client) {
                            continue;
                        }
                        broadcastClients.push(client);
                        broadCastClients++
                        connectedClients++;
                        //under reliable channel

                        if (isRealiableChannel) {
                            updateReliableChannelSettings(client);
                        }
                    }

                }

                if (isRealiableChannel &&
                    message.singleWorkerOnRole && message.singleWorkerOnRole[channleGroup] &&
                    message.singleWorkerOnRole[channleGroup].serverId == self.serverId &&
                    roomclients[message.singleWorkerOnRole[channleGroup].workerId]) {


                    let client = io.sockets.connected[message.singleWorkerOnRole[channleGroup].workerId];
                    if (!client) {
                        continue;
                    }

                    //console.log("single emitter recieved on broadcasting", client.id)
                    broadcastClients.push(client);
                    broadCastClients++
                    connectedClients++;
                    singelEmittClients++;
                    updateReliableChannelSettings(client);
                }
                else {
                    addAllclientsInRoom();
                }
                if (broadcastClients && broadcastClients.length) {
                    messenger.sendMessageToclient(broadcastClients[0], repo, message, broadcastClients,collection);
                }
            }
            //individual messages
            let individualUsers: Array<string> = messenger.getAllUsersForNotification(message);
            if (individualUsers && individualUsers.length) {
                individualUsers.forEach((user: string) => {
                    if (self.sessionSocketIdMap[user]) {
                        for (let channelId in self.sessionSocketIdMap[user]) {

                            let client = io.sockets.connected[channelId];
                            if (!client) {
                                continue;
                            }

                            //check if already broadcasted
                            if (client.handshake.query && client.handshake.query.broadcastChannels) {
                                let channelArr: Array<string> = client.handshake.query.broadcastChannels.filter((x) => { return x.name==key });
                                if (channelArr && channelArr.length) {
                                    continue;
                                }
                            }

                            connectedClients++;
                            individualClients++;
                            messenger.sendMessageToclient(client, repo, message,undefined,collection);
                            if (client.handshake.query && client.handshake.query.reliableChannles) {
                                let channelArr: Array<string> = client.handshake.query.reliableChannles.split(",");
                                if (channelArr.indexOf(key) > -1) {
                                    updateReliableChannelSettings(client);
                                }
                            }
                        }
                    }
                });
            }
            messageSendStatistics.connectedClients = connectedClients;
            messageSendStatistics.broadCastClients = broadCastClients;
            messageSendStatistics.reliableClients = reliableClients;
            messageSendStatistics.individualClients = individualClients;
            messageSendStatistics.singelEmittClients = singelEmittClients;
            messageSendStatistics.channel = key;
            messageSendStatistics.id = message._id && message._id.toString();
            //console.log("pub-sub message sent ", messageSendStatistics);
        };

        messageBraodcastOnMessenger = messageOnMessenger;

        

        
    }
}