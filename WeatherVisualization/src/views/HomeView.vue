<script setup lang="ts">
import ScaleScreen from "@/components/scale-screen";
import MessageContent from "@/components/Plugins/MessageContent";
import ChatPanel from "@/components/ChatPanel.vue";
import { useSettingStore } from "@/stores/index";
import { storeToRefs } from "pinia";

import Headers from "./header.vue";
import Setting from "./setting.vue";

function normalizePlaceName(name: string): string {
  if (!name) return "";
  const suffixes = [
    "壮族自治区", "回族自治区", "维吾尔自治区", "自治区", "特别行政区",
    "藏族羌族自治州", "蒙古族藏族自治州", "傣族景颇族自治州", "傈僳族自治州",
    "藏族自治州", "布依族苗族自治州", "苗族侗族自治州", "哈尼族彝族自治州",
    "壮族苗族自治州", "彝族苗族自治州", "土家族苗族自治州", "朝鲜族自治州",
    "蒙古自治州", "回族自治州", "傣族自治州", "白族自治州", "彝族自治州",
    "哈萨克自治州", "柯尔克孜自治州", "黎族苗族自治县", "黎族自治县",
    "土家族苗族自治州", "地区", "自治州", "省", "盟", "市",
  ];
  for (const suffix of suffixes) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
}




const { isScale } = storeToRefs(settingStore);
const wrapperStyle = {};


<template>
  <scale-screen
    width="1920"
    height="1080"
    :delay="500"
    :fullScreen="false"
    :boxStyle="{
      background: `url('/src/assets/img/background1.png') center center / cover no-repeat`,
      overflow: isScale ? 'hidden' : 'auto',
    }"
    :wrapperStyle="wrapperStyle"
    :autoScale="isScale"
  >
    <div class="content_wrap">
      <Headers />
      <RouterView />
      <MessageContent />
    </div>
  </scale-screen>

  <Setting />
  <ChatPanel />
</template>


<style scoped>
.content_wrap {
  width: 100%;
  height: 100%;
}
</style>
