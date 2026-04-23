<template>
  <div class="clip-frame">
    <iframe
      src="http://localhost/chatbot/ddPnoHWKT07l1CoZ"
      class="my-iframe"
      frameborder="0"
      allow="microphone"
    ></iframe>
  </div>
</template>

<style scoped>
.clip-frame {
  width: 370px;   /* 你想要显示的区域宽度 */
  height: 590px;  /* 你想要显示的区域高度 */
  overflow: hidden;
  position: relative;
  border-radius: 18px; /* 可选：加点圆角 */
  box-shadow: 0 2px 12px #0002;
}

/* 如果要偏移显示iframe内部某部分，加transform */
.my-iframe {
  width: 370px;  /* 假设iframe内容实际宽度更大 */
  height: 650px;
  border: none;
  /* 只显示中间区域，例如左移200px，上移100px */
  /* transform: translate(-200px, -100px); */
}
</style>
