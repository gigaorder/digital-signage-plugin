<template>
    <v-layout row style="height: 100%">
        <v-dialog v-model="dialogPushToDevice" width="500">
            <push-to-device
                    :devices="devices"
                    :model.sync="dialogPushToDevice"
                    :online-devices="onlineDevices"
                    @push-notify="pushNotify"
            />
        </v-dialog>
        <v-dialog v-model="trackProgressModel" width="1200">
            <div style="height: 90vh; background: #fff; overflow: auto">
                <progress-tracking v-if="trackProgressModel" />
            </div>
        </v-dialog>
        <v-dialog width="800" v-model="showDialogDelete">
            <delete-playlist-dialog
                    :model="showDialogDelete"
                    :delete-item="deletingItem"
                    @remove-file="removePlaylist"
                    @close-dialog="showDialogDelete = false"></delete-playlist-dialog>
        </v-dialog>
        <v-flex shrink style="border-right: 1px solid #ddd; width: 300px">
            <v-layout row wrap fill-height>
                <v-list dense style="width: 100%"
                >
                    <v-list-tile v-for="item in playlist" @click="selectItem(item)"
                                 :key="item._id"
                                 :class="{'selected-playlist':isSelected(item)}">
                        <v-list-tile-content>
                            <v-list-tile-title>{{item.name}}</v-list-tile-title>
                        </v-list-tile-content>
                    </v-list-tile>
                </v-list>
            </v-layout>
        </v-flex>
        <v-flex grow>
            <v-container fluid>
                <v-layout row wrap v-if="selectedPlaylist">
                    <v-flex md12>
                        <v-card style="width: 100%">
                            <v-list class="four-line"
                            >
                                <template
                                        v-for="(item, index) in selectedPlaylist.content"
                                >
                                    <v-list-tile
                                            :key="item.path"
                                            avatar
                                    >
                                        <v-list-tile-avatar size="100">
                                            <thumbnail :item="item.media"></thumbnail>
                                        </v-list-tile-avatar>
                                        <v-list-tile-content>
                                            <v-list-tile-title>name: {{item.media.name}}</v-list-tile-title>
                                            <v-list-tile-sub-title class="sub-title">path: {{item.media.path}}
                                            </v-list-tile-sub-title>
                                            <v-list-tile-sub-title class="sub-title">
                                                {{item.media.resolution}}, {{item.media.duration}}s
                                                ({{item.media.type}})
                                            </v-list-tile-sub-title>
                                        </v-list-tile-content>
                                    </v-list-tile>
                                    <v-divider
                                            v-if="index + 1 < selectedPlaylist.content.length"
                                            :key="index"
                                    ></v-divider>
                                </template>
                                <p class="text-xs-center" v-if="selectedPlaylist.content.length===0">
                                    This playlist is empty
                                </p>
                            </v-list>
                            <v-card-actions>
                                <v-btn @click="onClickDelete" flat color="red"

                                >
                                    Delete
                                </v-btn>
                            </v-card-actions>
                        </v-card>
                    </v-flex>
                </v-layout>
            </v-container>
        </v-flex>

    </v-layout>
</template>

<script>
  import io from 'socket.io-client';

  export default {
    name: 'Playlist',
    data: () => ({
      drawer: true,
      drawerRight: true,
      right: null,
      left: null,
      playlist: [],
      selectedPlaylist: null,
      devices: [],
      selectedDevices: [],
      onlineDevices: [],
      dialogPushToDevice: false,
      showDialogDelete: false,
      trackProgressModel: false,
      deletingItem: null,
      progress: []
    }),
    props: {
      source: String
    },
    methods: {
      onClickDelete() {
        this.showDialogDelete = true;
        this.deletingItem = this.selectedPlaylist;
      },
      removePlaylist(playlist, schedules = []) {
        Promise.all([
          cms.getModel('Playlist').remove({ _id: playlist._id }),
          cms.getModel('Schedule').remove({ _id: { $in: schedules.map(i => i._id) } })
        ])
          .then(res => {
            this.getPlaylist();
            this.showDialogDelete = false;
            console.log(res);
          });
      },
      isOnline(device) {
        return this.onlineDevices.indexOf(device._id) > -1;
      },
      isSelected(item) {
        if (!this.selectedPlaylist) {
          return false;
        }
        return this.selectedPlaylist._id === item._id;
      },
      changeDevice(event, token) {
        if (event === true) {
          const isExist = this.selectedDevices.includes(token);
          if (!isExist) {
            this.selectedDevices.push(token);
          }
        } else {
          this.selectedDevices = this.selectedDevices.filter(i => i !== token);
        }
      },
      getPlaylist() {
        const Model = cms.getModel('Playlist');
        Model.find({}).then(res => this.playlist = res);
      },
      selectItem(item) {
        const Model = cms.getModel('Playlist');
        Model.findById(item._id).populate('content.media').populate('device').then(res => {
          this.selectedPlaylist = res;
          console.log(res);
          this.selectedPlaylist.content = res.content.filter(item => item.media);
        });
      },
      pushNotify(selectedDevices) {
        this.$options.socket.emit('WEB_LISTENER_PUSH_PLAYLIST_TO_DEVICE', selectedDevices, this.selectedPlaylist._id, err => {
          this.$confirm(`Push to device success${err ? `, number of error: ${err.length}` : ''}`, {
            buttons: [
              {
                text: 'track progress',
                value: true,
                color: 'primary',
                onClick: () => this.trackProgressModel = true
              },
              {
                text: 'close',
                value: true,
                color: 'primary'
              }
            ]
          });
        });
      },
      getDevices() {
        const Model = cms.getModel('Device');
        Model.find({}).then((res) => {
          console.log(res);
          this.devices = res;
        });
      },
      connectSocket() {
        this.$options.socket = io.connect(cms.baseUrl + 'file-manager-web', {
          query: {
            token: localStorage.getItem('__token')
          }
        });
        this.$options.socket.on('WEB_EVENT_PLAYLIST_PROGRESS', res => {
          this.progress = res;
        });
        this.$options.socket.on('connect', () => {
          this.$options.socket.emit('WEB_LISTENER_GET_ONLINE_DEVICE');
        });
        this.$options.socket.on('WEB_EVENT_LIST_ONLINE_DEVICE', (list) => {
          this.onlineDevices = list;
        });
      }
    },
    mounted() {
      this.getPlaylist();
      this.getDevices();
      this.connectSocket();
    },
    beforeDestroy() {
      this.$options.socket && this.$options.socket.close();
    }
  };
</script>

<style scoped lang="scss">
    .selected-playlist {
        background-color: #03a9f4;
        color: #fff;

        .v-list__tile__title {
            transition: none !important;
        }
    }

    .four-line {
        .v-list__tile__avatar,
        .v-list__tile__content,
        .v-list__tile {
            height: 112px;
        }
    }

    .online {
        color: #40bf5e
    }

    .offline {
        color: #c14444
    }

    .sub-title {
        overflow: hidden;
        height: 20px;
        line-height: 20px;
        text-overflow: ellipsis
    }
</style>

<style>
    .radio-group .v-input__control {
        width: 100%
    }
</style>
