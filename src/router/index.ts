import { createRouter, createWebHistory } from 'vue-router'
import WildcardListView from '../views/WildcardListView.vue'
import ConstraintListView from '../views/ConstraintListView.vue'
import PipelineListView from '../views/PipelineListView.vue'

export const router = createRouter({
  history: createWebHistory('/wp/'),
  routes: [
    { path: '/', redirect: '/wildcards' },
    { path: '/wildcards', component: WildcardListView },
    { path: '/constraints', component: ConstraintListView },
    { path: '/pipelines', component: PipelineListView }
  ]
})
