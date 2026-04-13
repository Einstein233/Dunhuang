import { ref, computed, reactive, watch } from 'vue'
import { defineStore } from 'pinia'
// import { storeToRefs } from 'pinia';
export const useDataStore = defineStore('data', () => {
    const cardShow = ref<boolean>(false);
    const date = ref<string>();
    const pointPosition = ref<{ lng: number, lat: number }>();
    const setCardShow = (val: boolean) => {
        if (date.value && pointPosition.value) {
            cardShow.value = val;
        }
    }
    const setDate = (val: string) => {
        date.value = val;
        console.log(date.value)
    }
    const setPointPosition = (pos: { lng: number, lat: number }) => {
        pointPosition.value = pos;
    }

    return {date, pointPosition, cardShow, setDate, setPointPosition, setCardShow}
})
