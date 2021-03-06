const _ = require('lodash');
const Joi = require('joi');
const Device = cms.getModel('Device');
const ConnectionHistory = cms.getModel('ConnectionHistory');
const Content = cms.getModel('Content');
const Playlist = cms.getModel('Playlist');
const Job = cms.getModel('Job');
const Schedule = cms.getModel('Schedule');

const EVENT = {
  APP_ACTION_DELETE_FILE: 'APP_ACTION_DELETE_FILE',
  APP_ACTION_PUSH_FILES: 'APP_ACTION_PUSH_FILES',
  APP_ACTION_PUSH_PLAYLIST: 'APP_ACTION_PUSH_PLAYLIST',
  APP_ACTION_DELETE_PLAYLIST: 'APP_ACTION_DELETE_PLAYLIST',
  APP_ACTION_SET_ACTIVE_PLAYLIST: 'APP_ACTION_SET_ACTIVE_PLAYLIST',
  APP_ACTION_PUSH_SCHEDULE: 'APP_ACTION_PUSH_SCHEDULE',
  APP_EVENT_RECEIVE_FILE: 'APP_EVENT_RECEIVE_FILE',
  APP_EVENT_RECEIVE_PLAYLIST: 'APP_EVENT_RECEIVE_PLAYLIST',
  APP_EVENT_RECEIVE_SCHEDULE: 'APP_EVENT_RECEIVE_SCHEDULE',
  APP_EVENT_FAILED_JOB: 'APP_EVENT_FAILED_JOB',
  APP_LISTENER_FILE_PROGRESS: 'APP_LISTENER_FILE_PROGRESS',
  APP_LISTENER_PLAYLIST_PROGRESS: 'APP_LISTENER_PLAYLIST_PROGRESS',
  APP_LISTENER_DOWNLOAD_FILE: 'APP_LISTENER_DOWNLOAD_FILE',
  WEB_LISTENER_DELETE_FILE: 'WEB_LISTENER_DELETE_FILE',
  WEB_LISTENER_GET_LIST_FILE: 'WEB_LISTENER_GET_LIST_FILE',
  WEB_LISTENER_GET_PLAYLIST: 'WEB_LISTENER_GET_PLAYLIST',
  WEB_LISTENER_DELETE_PLAYLIST: 'WEB_LISTENER_DELETE_PLAYLIST',
  WEB_LISTENER_SET_ACTIVE_PLAYLIST: 'WEB_LISTENER_SET_ACTIVE_PLAYLIST',
  WEB_EVENT_LIST_FILE: 'WEB_EVENT_LIST_FILE',
  WEB_EVENT_FILE_PROGRESS: 'WEB_EVENT_FILE_PROGRESS',
  WEB_EVENT_PLAYLIST_PROGRESS: 'WEB_EVENT_PLAYLIST_PROGRESS',
  WEB_EVENT_LIST_PLAYLIST: 'WEB_EVENT_LIST_PLAYLIST',
  WEB_EVENT_LIST_ONLINE_DEVICE: 'WEB_EVENT_LIST_ONLINE_DEVICE',
  WEB_LISTENER_VIEW_DEVICE: 'WEB_LISTENER_VIEW_DEVICE',
  WEB_LISTENER_GET_ONLINE_DEVICE: 'WEB_LISTENER_GET_ONLINE_DEVICE',
  WEB_LISTENER_PUSH_FILE_TO_DEVICE: 'WEB_LISTENER_PUSH_FILE_TO_DEVICE',
  WEB_LISTENER_PUSH_PLAYLIST_TO_DEVICE: 'WEB_LISTENER_PUSH_PLAYLIST_TO_DEVICE',
  WEB_LISTENER_VIEW_PROGRESS: 'WEB_LISTENER_VIEW_PROGRESS',
  WEB_LISTENER_CLOSE_PROGRESS: 'WEB_LISTENER_CLOSE_PROGRESS',
  WEB_LISTENER_PUSH_SCHEDULE: 'WEB_LISTENER_PUSH_SCHEDULE',
  // WEB_LISTENER_CLOSE_PROGRESS: 'WEB_LISTENER_CLOSE_PROGRESS',
  ERROR: 'ERROR'
};


const contentSchema = Joi.object().keys({
  _id: Joi.string().required(),
  name: Joi.string(),
  type: Joi.string(),
  status: Joi.boolean(),
  ext: Joi.string(),
  path: Joi.string(),
  parts: Joi.array().items(Joi.string()),
  tag: Joi.array()
});

const playlistSchema = Joi.object().keys({
  content: Joi.array().items(Joi.object().keys({ media: contentSchema, duration: Joi.number() })),
  _id: Joi.string(),
  name: Joi.string()
});

const arrayPlaylistSchema = Joi.array().items(playlistSchema);

const progressSchema = Joi.array().items(
  Joi.object().keys({
    name: Joi.string(),
    progress: Joi.number()
  })
);

function verifyTokenMiddleware(socket, next) {
  const token = socket.handshake.query.token;
  if (!token) {
    socket.disconnect();
    next('token must be provide');
  } else {
    Device.findOne({ token: token })
      .then(res => {
        if (res) {
          socket.device = res;
          next();
        } else {
          socket.disconnect();
          return next('device not found');
        }
      })
      .catch(err => {
        socket.disconnect();
        next(err);
      });
  }
}

// progress = [{name: 'abc', progress: 0.4},{name: 'xyz', progress: 0.45}];

function findLatestFailedJob(deviceId) {
  return Job.findOne({ device: deviceId, content: { $exists: true }, status: 'fail' })
    .sort('-begin')
}

function changeStatusDevice(socket, status) {
  const data = {
    device: socket.device._id,
    date: new Date(),
    type: status ? 'online' : 'offline',
    ip: socket.handshake.address
  };
  ConnectionHistory.create(data);
  // Device.findOneAndUpdate({ _id: socket.device._id }, { online: status }).then(res => console.log(res)).catch(err => console.log(err));
}

module.exports = cms => {
  const appNamespace = cms.io.of('/file-manager-app');
  const webNamespace = cms.io.of('/file-manager-web');
  const onlineDevices = {};

  cms.app.post('/digital/p2p', function (req, res) {
    const data = req.body.data;
    const deviceId = req.body.deviceId;
    const event = req.body.event;
    const socketDevice = onlineDevices[deviceId];
    if (socketDevice) {
      let responded = false;
      socketDevice.emit(event, data, (cbData) => {
        if (!responded) {
          res.status(200).json({ ok: 'ok', data: cbData });
          responded = true;
        }
      });
      setTimeout(() => {
        if (!responded) {
          res.status(400).json({ error: 'Connect device timeout' });
          responded = true;
        }
      }, 8000);
    } else {
      res.status(400).json({ error: 'device offline' });
    }
  });

  appNamespace.use(verifyTokenMiddleware);
  appNamespace.on('connection', function (socket) {
    if (onlineDevices[socket.device._id]) {
      onlineDevices[socket.device._id].disconnect();
      console.log('disconnect previous session');
    }
    onlineDevices[socket.device._id] = socket;
    webNamespace.emit(EVENT.WEB_EVENT_LIST_ONLINE_DEVICE, Object.keys(onlineDevices));
    changeStatusDevice(socket, true);
    findLatestFailedJob(socket.device._id).then(res => {
      if (res) {
        socket.emit(EVENT.APP_EVENT_RECEIVE_SCHEDULE, res.content.schedule, res);
      }
    });

    socket.on(EVENT.APP_LISTENER_FILE_PROGRESS, (jobId, data) => {
      const isValid = progressSchema.validate(data, { allowUnknown: true });
      if (!isValid.error) {
        Promise.all([
          Job.findById(jobId),
          Device.findById(socket.device._id)
        ]).then(([job, device]) => {
          webNamespace.to(`downloadFile`).emit(EVENT.WEB_EVENT_FILE_PROGRESS, { job, data, device });
        });
      }
    });

    socket.on(EVENT.APP_LISTENER_DOWNLOAD_FILE, (jobId, status, type = 'file') => {
      const updateData = {
        status
      };
      if (status === 'finish' || status === 'fail') {
        updateData.end = new Date();
      }
      Job.findByIdAndUpdate(jobId, updateData, { new: true }).then(res => {
        webNamespace.to(`downloadFile`).emit(EVENT.WEB_EVENT_FILE_PROGRESS, { job: res });
      });
    });

    socket.on('APP_LISTENER_SEND_LOG', async (status, data) => {
      await webNamespace.emit('WEB_EVENT_LOG_SEND', { status: status, data: data });
    });

    socket.on('APP_ACTION_PUSH_START_LOG', async (status, data) => {
      await webNamespace.emit('WEB_EVENT_PUSH_START_LOG', { status, data });
    });

    socket.on('APP_ACTION_PUSH_MEMORY_LOG', async (status, data) => {
      await webNamespace.emit('WEB_EVENT_PUSH_MEMORY_LOG', { status, data });
    });

    socket.on('disconnect', () => {
      // update connection history
      changeStatusDevice(socket, false);
      // if device have running job, update it to fail.
      Job.findOneAndUpdate({ device: socket.device._id, status: 'running' }, { status: 'fail', end: new Date() }, { new: true })
        .sort('-begin')
        .then(res => {
          // then response status to web client
          if (res) {
            webNamespace.to(`downloadFile`).emit(EVENT.WEB_EVENT_FILE_PROGRESS, { job: res });
          }
        });
      if (onlineDevices[socket.device._id] === socket) {
        delete onlineDevices[socket.device._id]; // remove from online devices
      }
      webNamespace.emit(EVENT.WEB_EVENT_LIST_ONLINE_DEVICE, Object.keys(onlineDevices)); // emit online devices to client
    });
  });

  webNamespace.on('connection', function (socket) {
    socket.on(EVENT.WEB_LISTENER_GET_ONLINE_DEVICE, () => {
      socket.emit(EVENT.WEB_EVENT_LIST_ONLINE_DEVICE, Object.keys(onlineDevices));
    });


    socket.on(EVENT.WEB_LISTENER_VIEW_DEVICE, deviceId => {
      socket.leaveAll();
      socket.join(`files${deviceId}`);
    });

    socket.on(EVENT.WEB_LISTENER_VIEW_PROGRESS, () => {
      socket.join(`downloadFile`);
    });

    socket.on(EVENT.WEB_LISTENER_CLOSE_PROGRESS, () => {
      socket.leave(`downloadFile`);
    });

    socket.on(EVENT.WEB_LISTENER_PUSH_SCHEDULE, async (data, fn) => {
      const deviceIds = data.devices, scheduleId = data.schedule, jobId = data.job;
      Promise.all(deviceIds.map(async deviceId => {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          try {
            const isRunningJob = await Job.findOne({device: deviceId, status: 'running'});
            if (isRunningJob) {
              return `device ${deviceId} is running another job`;
            }
            const schedule = await Schedule.findById(scheduleId);
            let job;
            if (jobId) {
              job = await Job.findById(jobId);
            } else {
              job = await Job.create({
                device: deviceId,
                begin: new Date(),
                type: 'pushSchedule',
                status: null,
                content: {
                  schedule: scheduleId,
                  contentType: 'schedule'
                }
              });
            }
            deviceSocket.emit(EVENT.APP_EVENT_RECEIVE_SCHEDULE, schedule, job);
          } catch (err) {
            return err.message;
          }
        } else {
          return `device ${deviceId} offline`;
        }
      })).then(res => {
        const err = res.filter(i => i);
        const isError = err.length > 0;
        if (isError) {
          fn(err);
        } else {
          fn();
        }
      });
    });

    socket.on(EVENT.WEB_LISTENER_PUSH_FILE_TO_DEVICE, async (deviceIds, files, fn) => {
      Promise.all(deviceIds.map(async deviceId => {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          // socket.join(`downloadFile${deviceId}`);
          try {
            const content = await Content.find({ path: { $in: files } });
            const job = await Job.create({ device: deviceId, begin: new Date(), type: 'pushFile', status: null });
            deviceSocket.emit(EVENT.APP_EVENT_RECEIVE_FILE, content, job);
          } catch (err) {
            return err.message;
          }
        } else {
          return `device ${deviceId} offline`;
        }
      })).then(res => {
        const err = res.filter(i => i);
        const isError = err.length > 0;
        if (isError) {
          fn(err);
        } else {
          fn();
        }
      });
    });
    socket.on(EVENT.WEB_LISTENER_PUSH_PLAYLIST_TO_DEVICE, async (deviceIds, playlistId, fn) => {
      Promise.all(deviceIds.map(async deviceId => {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          try {
            const res = await Playlist.findById(playlistId).populate('content.media').populate('device');
            const pushData = _.pick(res, ['content', 'id', 'name']);
            const job = await Job.create({ device: deviceId, begin: new Date(), type: 'pushPlaylist', status: null });
            deviceSocket.emit(EVENT.APP_EVENT_RECEIVE_PLAYLIST, pushData, job);
          } catch (err) {
          }
        } else {
          return `device ${deviceId} offline`;
        }
      })).then(res => {
        const err = res.filter(i => i);
        const isError = err.length > 0;
        if (isError) {
          fn(err);
        } else {
          fn();
        }
      });
    });

    socket.on(EVENT.WEB_LISTENER_GET_LIST_FILE, (deviceId, callbackOnViewDevice) => {
      if (deviceId) {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          deviceSocket.emit(EVENT.APP_ACTION_PUSH_FILES, (err, data) => {
            if (err) {
              callbackOnViewDevice(err);
            } else {
              callbackOnViewDevice(null, data);
            }
          });
          setTimeout(() => {
            callbackOnViewDevice('connect device timeout');
          }, 8000);
        } else {
          callbackOnViewDevice('device offline');
        }
      } else {
        callbackOnViewDevice('id is require');
      }
    });

    socket.on(EVENT.WEB_LISTENER_DELETE_FILE, (deviceId, name, onDone) => {
      if (deviceId && name) {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          deviceSocket.emit(EVENT.APP_ACTION_DELETE_FILE, name, (err, data) => {
            onDone(err, data);
            socket.broadcast.in(`files${deviceId}`).emit(EVENT.WEB_EVENT_LIST_FILE, data);
          });
        } else {
          onDone('device offline');
        }
      } else {
        onDone('name and id is require');
      }
    });

    socket.on(EVENT.WEB_LISTENER_GET_PLAYLIST, (deviceId, callbackOnViewPlaylist) => {
      if (deviceId) {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          deviceSocket.emit(EVENT.APP_ACTION_PUSH_PLAYLIST, (err, playlist) => {
            if (err) {
              callbackOnViewPlaylist(err);
            } else {
              // const isValid = arrayPlaylistSchema.validate(playlist, { allowUnknown: true });
              // if (isValid.error) {
              //   console.log('error on receive playlist', isValid.error.message);
              //   callbackOnViewPlaylist(isValid.error.message);
              // } else {
              callbackOnViewPlaylist(null, playlist);
              // }
            }
          });
          setTimeout(() => {
            callbackOnViewPlaylist('connect device timeout');
          }, 8000);
        }
      } else {
        callbackOnViewPlaylist('id is require');
      }
    });

    socket.on(EVENT.WEB_LISTENER_DELETE_PLAYLIST, (deviceId, playlistId, callbackOnDeletePlaylist) => {
      if (deviceId && playlistId) {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          deviceSocket.emit(EVENT.APP_ACTION_DELETE_PLAYLIST, playlistId, (err, playlist) => {
            if (err) {
              callbackOnDeletePlaylist(err);
            } else {
              callbackOnDeletePlaylist(null, playlist);
              socket.broadcast.in(`files${deviceId}`).emit(EVENT.WEB_EVENT_LIST_PLAYLIST, playlist);
            }
          });
          setTimeout(() => {
            callbackOnDeletePlaylist('connect device timeout');
          }, 8000);
        }
      } else {
        callbackOnDeletePlaylist('device id and playlist id is require');
      }
    });

    socket.on(EVENT.WEB_LISTENER_SET_ACTIVE_PLAYLIST, (deviceId, playlistId, callbackOnDeletePlaylist) => {
      if (deviceId && playlistId) {
        const deviceSocket = onlineDevices[deviceId];
        if (deviceSocket) {
          deviceSocket.emit(EVENT.APP_ACTION_SET_ACTIVE_PLAYLIST, playlistId, (err, playlist) => {
            if (err) {
              callbackOnDeletePlaylist(err);
            } else {
              callbackOnDeletePlaylist(null, playlist);
            }
          });
          setTimeout(() => {
            callbackOnDeletePlaylist('connect device timeout');
          }, 8000);
        }
      } else {
        callbackOnDeletePlaylist('device id and playlist id is require');
      }
    });
  });
};
