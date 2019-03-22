const deviceService = require('./devices.service');

module.exports.getList = function (req, res) {
  deviceService.getList()
    .then(data => {
      res.status(200).json({ data });
    })
    .catch(err => {
      res.status(400).json({ err });
    });
};

module.exports.register = function (req, res) {

  const info = {
    'token': req.body.token,
    'device-name': req.body.deviceName,
    'os': req.body.os,
    'os-version': req.body.osVersion,
    'model': req.body.model
  };

  deviceService.register(info)
    .then(data => {
      res.status(200).json({ data });
    })
    .catch(err => {
      res.status(400).json({ err });
    });
};

module.exports.pushMessage = function (req, res) {
  const files = req.body.files;
  const tokens = req.body.token;
  const MediaFile = cms.getModel('MediaFile');
  MediaFile.find({ path: { $in: files } })
    .then(data => {
      return deviceService.pushMessage(tokens, data);
    })
    .then((r) => res.status(200).json(r))
    .catch(err => res.status(400).json({ err }));
};
