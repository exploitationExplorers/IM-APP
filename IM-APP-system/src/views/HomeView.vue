<script setup lang="ts">
import welcomeImage from "../assets/images/welcome.png";
</script>

<template>
  <section class="home card">
    <img class="home-bg" :src="welcomeImage" alt="欢迎进入 IM-APP 管理系统" />
  </section>
</template>

<style scoped lang="scss">
.home {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 100%;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 0 12px rgb(0 0 0 / 5%);
}
.home-bg {
  width: 70%;
  max-width: 1200px;
  margin-bottom: 20px;
}
@media (max-width: 700px) {
  .home-bg {
    width: 92%;
  }
}
</style>
