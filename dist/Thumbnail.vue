<template>
    <!--    <i class="far fa-folder grid-icon" v-if="item.type==='directory'"></i>-->
    <img src="/plugins/digital-signage-plugin/screens/FileManager/icon/folder_icon.svg" v-if="item.type==='directory'" class="preview-image">
    <img :src="item.thumbnail" v-else-if="item.thumbnail" class="preview-image">
    <!--    <video :src="getPreviewUrl(item.path)" class="preview-image"-->
    <!--           v-else-if="isVideo(item.extension || item.ext)"></video>-->
    <!--    <img :src="getPreviewUrl(item.path)" class="preview-image"-->
    <!--         v-else-if="isImage(item.extension  || item.ext)" />-->
    <i class="far fa-file grid-icon" v-else=""></i>
</template>
<script>
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = {
  name: 'Thumbnail',
  props: ['item'],
  methods: {
    getPreviewUrl(path) {
      return `${cms.baseUrl}video/${path}`;
    },

    isVideo(ext) {
      return ['.mp4', '.mkv', '.mov'].includes(ext);
    },

    isImage(ext) {
      return ['.jpg', '.jpeg', '.png', '.bmp'].includes(ext);
    }

  }
};
exports.default = _default;
</script> 
<style>
    .preview-image {
        height: 50px !important;
        max-width: 70px;
        align-self: center;
        border-radius: 0 !important;
    }
</style>
