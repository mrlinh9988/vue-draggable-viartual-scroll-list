/**
 * virtual list default component
 */

import Vue from 'vue'
import Virtual from './virtual'
import { Item } from './item'
import { VirtualProps, draggableProps } from './props'
import Sortable from 'sortablejs'
import { insertNodeAt, camelize, console, removeNode } from './util/helper'

const draggableEvents = ['moved', 'added', 'removed']

// Draggable

function buildAttribute (object, propName, value) {
  if (value === undefined) {
    return object
  }
  object = object || {}
  object[propName] = value
  return object
}

function computeVmIndex (vnodes, element) {
  return vnodes.map(elt => elt.elm || elt.$vnode.elm).indexOf(element)
}

function computeIndexes (slots, children, isTransition, footerOffset) {
  if (!slots) {
    return []
  }

  const elmFromNodes = slots.map(elt => elt.elm || elt.$vnode.elm)
  const footerIndex = children.length - footerOffset
  const rawIndexes = [...children].map((elt, idx) => idx >= footerIndex ? elmFromNodes.length : elmFromNodes.indexOf(elt)
  )

  return isTransition ? rawIndexes.filter(ind => ind !== -1) : rawIndexes
}

function emit (evtName, evtData) {
  this.$nextTick(() => this.$emit(evtName.toLowerCase(), evtData))
}

function delegateAndEmit (evtName) {
  return evtData => {
    if (this.realList !== null) {
      this['onDrag' + evtName](evtData)
    }
    emit.call(this, evtName, evtData)
  }
}

function isTransitionName (name) {
  return ['transition-group', 'TransitionGroup'].includes(name)
}

function isTransition (slots) {
  if (!slots || slots.length !== 1) {
    return false
  }
  const [{ componentOptions }] = slots
  if (!componentOptions) {
    return false
  }
  return isTransitionName(componentOptions.tag)
}

function getSlot (slot, scopedSlot, key) {
  return slot[key] || (scopedSlot[key] ? scopedSlot[key]() : undefined)
}

function computeChildrenAndOffsets (children, slot, scopedSlot) {
  let headerOffset = 0
  let footerOffset = 0
  const header = getSlot(slot, scopedSlot, 'header')
  if (header) {
    headerOffset = header.length
    children = children ? [...header, ...children] : [...header]
  }
  const footer = getSlot(slot, scopedSlot, 'footer')
  if (footer) {
    footerOffset = footer.length
    children = children ? [...children, ...footer] : [...footer]
  }
  return { children, headerOffset, footerOffset }
}

function getComponentAttributes ($attrs, componentData) {
  let attributes = null
  const update = (name, value) => {
    attributes = buildAttribute(attributes, name, value)
  }
  const attrs = Object.keys($attrs)
    .filter(key => key === 'id' || key.startsWith('data-'))
    .reduce((res, key) => {
      res[key] = $attrs[key]
      return res
    }, {})
  update('attrs', attrs)

  if (!componentData) {
    return attributes
  }
  const { on, props, attrs: componentDataAttrs } = componentData
  update('on', on)
  update('props', props)
  Object.assign(attributes.attrs, componentDataAttrs)
  return attributes
}

const eventsListened = ['Start', 'Add', 'Remove', 'Update', 'End']
const eventsToEmit = ['Choose', 'Unchoose', 'Sort', 'Filter', 'Clone']
const readonlyProperties = ['Move', ...eventsListened, ...eventsToEmit].map(
  evt => 'on' + evt
)
var draggingElement = null

// End Draggable

const EVENT_TYPE = {
  ITEM: 'item_resize',
  SLOT: 'slot_resize'
}
const SLOT_TYPE = {
  HEADER: 'thead', // string value also use for aria role attribute
  FOOTER: 'tfoot'
}

const VirtualList = Vue.component('virtual-list', {
  inheritAttrs: false,

  props: { ...VirtualProps, ...draggableProps },

  data () {
    return {
      range: null,

      // draggable
      transitionMode: false,
      noneFunctionalComponentMode: false,
      visibleRange: {
        start: 0
      },
      draggingIndex: null,
      draggingRealIndex: null,
      draggingVNode: null
    }
  },

  watch: {
    'dataSources.length' () {
      this.virtual.updateParam('uniqueIds', this.getUniqueIdFromDataSources())
      this.virtual.handleDataSourcesChange()
    },

    keeps (newValue) {
      this.virtual.updateParam('keeps', newValue)
      this.virtual.handleSlotSizeChange()
    },

    start (newValue) {
      this.scrollToIndex(newValue)
    },

    offset (newValue) {
      this.scrollToOffset(newValue)
    },

    options: {
      handler (newOptionValue) {
        this.updateOptions(newOptionValue)
      },
      deep: true
    },

    $attrs: {
      handler (newOptionValue) {
        this.updateOptions(newOptionValue)
      },
      deep: true
    },

    realList () {
      this.computeIndexes()
    }
  },

  created () {
    this.isHorizontal = this.direction === 'horizontal'
    this.directionKey = this.isHorizontal ? 'scrollLeft' : 'scrollTop'

    this.installVirtual()

    // listen item size change
    this.$on(EVENT_TYPE.ITEM, this.onItemResized)

    // listen slot size change
    if (this.$slots.header || this.$slots.footer) {
      this.$on(EVENT_TYPE.SLOT, this.onSlotResized)
    }

    // draggable
    if (this.list !== null && this.value !== null) {
      console.error(
        'Value and list props are mutually exclusive! Please set one or another.'
      )
    }

    if (this.element !== 'div') {
      console.warn(
        'Element props is deprecated please use tag props instead. See https://github.com/SortableJS/Vue.Draggable/blob/master/documentation/migrate.md#element-props'
      )
    }

    if (this.options !== undefined) {
      console.warn(
        'Options props is deprecated, add sortable options directly as vue.draggable item, or use v-bind. See https://github.com/SortableJS/Vue.Draggable/blob/master/documentation/migrate.md#options-props'
      )
    }
  },

  computed: {
    rootContainer () {
      return this.$el.children[0]
    },

    realList () {
      return this.list ? this.list : this.value
    }
  },

  activated () {
    // set back offset when awake from keep-alive
    this.scrollToOffset(this.virtual.offset)

    if (this.pageMode) {
      document.addEventListener('scroll', this.onScroll, {
        passive: false
      })
    }
  },

  deactivated () {
    if (this.pageMode) {
      document.removeEventListener('scroll', this.onScroll)
    }
  },

  mounted () {
    // set position
    if (this.start) {
      this.scrollToIndex(this.start)
    } else if (this.offset) {
      this.scrollToOffset(this.offset)
    }

    // in page mode we bind scroll event to document
    if (this.pageMode) {
      this.updatePageModeFront()

      document.addEventListener('scroll', this.onScroll, {
        passive: false
      })
    }

    // draggable
    this.noneFunctionalComponentMode =
      this.getTag().toLowerCase() !== this.$el.nodeName.toLowerCase() &&
      !this.getIsFunctional()
    if (this.noneFunctionalComponentMode && this.transitionMode) {
      throw new Error(
        `Transition-group inside component is not supported. Please alter tag value or remove transition-group. Current tag value: ${this.getTag()}`
      )
    }
    const optionsAdded = {}
    eventsListened.forEach(elt => {
      optionsAdded['on' + elt] = delegateAndEmit.call(this, elt)
    })

    eventsToEmit.forEach(elt => {
      optionsAdded['on' + elt] = emit.bind(this, elt)
    })

    const attributes = Object.keys(this.$attrs).reduce((res, key) => {
      res[camelize(key)] = this.$attrs[key]
      return res
    }, {})

    const options = Object.assign({}, this.options, attributes, optionsAdded, {
      onMove: (evt, originalEvent) => {
        return this.onDragMove(evt, originalEvent)
      }
    })
    !('draggable' in options) && (options.draggable = '>*')
    this._sortable = new Sortable(this.rootContainer, options)
    this.computeIndexes()
  },

  beforeDestroy () {
    this.virtual.destroy()
    if (this.pageMode) {
      document.removeEventListener('scroll', this.onScroll)
    }

    if (this._sortable !== undefined) this._sortable.destroy()
  },

  methods: {
    // get item size by id
    getSize (id) {
      return this.virtual.sizes.get(id)
    },

    // get the total number of stored (rendered) items
    getSizes () {
      return this.virtual.sizes.size
    },

    // return current scroll offset
    getOffset () {
      if (this.pageMode) {
        return document.documentElement[this.directionKey] || document.body[this.directionKey]
      } else {
        const { root } = this.$refs
        return root ? Math.ceil(root[this.directionKey]) : 0
      }
    },

    // return client viewport size
    getClientSize () {
      const key = this.isHorizontal ? 'clientWidth' : 'clientHeight'
      if (this.pageMode) {
        return document.documentElement[key] || document.body[key]
      } else {
        const { root } = this.$refs
        return root ? Math.ceil(root[key]) : 0
      }
    },

    // return all scroll size
    getScrollSize () {
      const key = this.isHorizontal ? 'scrollWidth' : 'scrollHeight'
      if (this.pageMode) {
        return document.documentElement[key] || document.body[key]
      } else {
        const { root } = this.$refs
        return root ? Math.ceil(root[key]) : 0
      }
    },

    // set current scroll position to a expectant offset
    scrollToOffset (offset) {
      if (this.pageMode) {
        document.body[this.directionKey] = offset
        document.documentElement[this.directionKey] = offset
      } else {
        const { root } = this.$refs
        if (root) {
          root[this.directionKey] = offset
        }
      }
    },

    // set current scroll position to a expectant index
    scrollToIndex (index) {
      // scroll to bottom
      if (index >= this.dataSources.length - 1) {
        this.scrollToBottom()
      } else {
        const offset = this.virtual.getOffset(index)
        this.scrollToOffset(offset)
      }
    },

    // set current scroll position to bottom
    scrollToBottom () {
      const { shepherd } = this.$refs
      if (shepherd) {
        const offset = shepherd[this.isHorizontal ? 'offsetLeft' : 'offsetTop']
        this.scrollToOffset(offset)

        // check if it's really scrolled to the bottom
        // maybe list doesn't render and calculate to last range
        // so we need retry in next event loop until it really at bottom
        setTimeout(() => {
          if (this.getOffset() + this.getClientSize() + 1 < this.getScrollSize()) {
            this.scrollToBottom()
          }
        }, 3)
      }
    },

    // when using page mode we need update slot header size manually
    // taking root offset relative to the browser as slot header size
    updatePageModeFront () {
      const { root } = this.$refs
      if (root) {
        const rect = root.getBoundingClientRect()
        const { defaultView } = root.ownerDocument
        const offsetFront = this.isHorizontal ? (rect.left + defaultView.pageXOffset) : (rect.top + defaultView.pageYOffset)
        this.virtual.updateParam('slotHeaderSize', offsetFront)
      }
    },

    // reset all state back to initial
    reset () {
      this.virtual.destroy()
      this.scrollToOffset(0)
      this.installVirtual()
    },

    // ----------- public method end -----------

    installVirtual () {
      this.virtual = new Virtual({
        slotHeaderSize: 0,
        slotFooterSize: 0,
        keeps: this.keeps,
        estimateSize: this.estimateSize,
        buffer: Math.round(this.keeps / 3), // recommend for a third of keeps
        uniqueIds: this.getUniqueIdFromDataSources()
      }, this.onRangeChanged)

      // sync initial range
      this.range = this.virtual.getRange()
    },

    getUniqueIdFromDataSources () {
      const { dataKey } = this
      return this.dataSources.map((dataSource) => typeof dataKey === 'function' ? dataKey(dataSource) : dataSource[dataKey])
    },

    // event called when each item mounted or size changed
    onItemResized (id, size) {
      this.virtual.saveSize(id, size)
      this.$emit('resized', id, size)
    },

    // event called when slot mounted or size changed
    onSlotResized (type, size, hasInit) {
      if (type === SLOT_TYPE.HEADER) {
        this.virtual.updateParam('slotHeaderSize', size)
      } else if (type === SLOT_TYPE.FOOTER) {
        this.virtual.updateParam('slotFooterSize', size)
      }

      if (hasInit) {
        this.virtual.handleSlotSizeChange()
      }
    },

    // here is the rerendering entry
    onRangeChanged (range) {
      this.range = range
    },

    onScroll (evt) {
      const offset = this.getOffset()
      const clientSize = this.getClientSize()
      const scrollSize = this.getScrollSize()

      // iOS scroll-spring-back behavior will make direction mistake
      if (offset < 0 || (offset + clientSize > scrollSize + 1) || !scrollSize) {
        return
      }

      this.virtual.handleScroll(offset)
      this.emitEvent(offset, clientSize, scrollSize, evt)
    },

    // emit event in special position
    emitEvent (offset, clientSize, scrollSize, evt) {
      this.$emit('scroll', evt, this.virtual.getRange())

      if (this.virtual.isFront() && !!this.dataSources.length && (offset - this.topThreshold <= 0)) {
        this.$emit('totop')
      } else if (this.virtual.isBehind() && (offset + clientSize + this.bottomThreshold >= scrollSize)) {
        this.$emit('tobottom')
      }
    },

    // get the real render slots based on range data
    // in-place patch strategy will try to reuse components as possible
    // so those components that are reused will not trigger lifecycle mounted
    getRenderSlots (h) {
      const slots = []
      const { start, end } = this.range
      const { dataSources, dataKey, itemClass, itemTag, itemStyle, isHorizontal, extraProps, dataComponent, itemScopedSlots } = this
      const slotComponent = this.$scopedSlots && this.$scopedSlots.item
      for (let index = start; index <= end; index++) {
        const dataSource = dataSources[index]
        if (dataSource) {
          const uniqueKey = typeof dataKey === 'function' ? dataKey(dataSource) : dataSource[dataKey]
          if (typeof uniqueKey === 'string' || typeof uniqueKey === 'number') {
            slots.push(h(Item, {
              props: {
                index,
                tag: itemTag,
                event: EVENT_TYPE.ITEM,
                horizontal: isHorizontal,
                uniqueKey: uniqueKey,
                source: dataSource,
                extraProps: extraProps,
                component: dataComponent,
                slotComponent: slotComponent,
                scopedSlots: itemScopedSlots
              },
              style: itemStyle,
              class: `${itemClass}${this.itemClassAdd ? ' ' + this.itemClassAdd(index) : ''}`
            }))
          } else {
            console.warn(`Cannot get the data-key '${dataKey}' from data-sources.`)
          }
        } else {
          console.warn(`Cannot get the index '${index}' from data-sources.`)
        }
      }
      return slots
    },

    getIsFunctional () {
      const { fnOptions } = this._vnode
      return fnOptions && fnOptions.functional
    },

    getTag () {
      return this.tag || this.element
    },

    updateOptions (newOptionValue) {
      for (var property in newOptionValue) {
        const value = camelize(property)
        if (readonlyProperties.indexOf(value) === -1) {
          this._sortable.option(value, newOptionValue[property])
        }
      }
    },

    getChildrenNodes () {
      // if (this.noneFunctionalComponentMode) {
      //   return this.$children[0].$slots.default
      // }
      // const rawNodes = this.$slots.default
      // return this.transitionMode ? rawNodes[0].child.$slots.default : rawNodes
      return this.$children
    },

    computeIndexes () {
      this.$nextTick(() => {
        this.visibleIndexes = computeIndexes(
          this.getChildrenNodes(),
          this.rootContainer.children,
          this.transitionMode,
          this.footerOffset
        )
      })
    },

    getUnderlyingVm (htmlElt) {
      const index = computeVmIndex(this.getChildrenNodes() || [], htmlElt)
      if (index === -1) {
        // Edge case during move callback: related element might be
        // an element different from collection
        return null
      }
      const element = this.realList[index]
      return { index, element }
    },

    getUnderlyingPotencialDraggableComponent ({ __vue__: vue }) {
      if (
        !vue ||
        !vue.$options ||
        !isTransitionName(vue.$options._componentTag)
      ) {
        if (
          !('realList' in vue) &&
          vue.$children.length === 1 &&
          'realList' in vue.$children[0]
        ) { return vue.$children[0] }

        return vue
      }
      return vue.$parent
    },

    emitChanges (evt) {
      this.$nextTick(() => {
        this.$emit('change', evt)
      })
    },

    alterList (onList) {
      if (this.list) {
        onList(this.list)
        return
      }
      const newList = [...this.value]
      onList(newList)
      this.$emit('input', newList)
    },

    spliceList () {
      const spliceList = list => list.splice(...arguments)
      this.alterList(spliceList)
    },

    updatePosition (oldIndex, newIndex) {
      const updatePosition = list =>
        list.splice(newIndex, 0, list.splice(oldIndex, 1)[0])
      this.alterList(updatePosition)
    },

    getRelatedContextFromMoveEvent ({ to, related }) {
      const component = this.getUnderlyingPotencialDraggableComponent(to)
      if (!component) {
        return { component }
      }
      const list = component.realList
      const context = { list, component }
      if (to !== related && list && component.getUnderlyingVm) {
        const destination = component.getUnderlyingVm(related)
        if (destination) {
          return Object.assign(destination, context)
        }
      }
      return context
    },

    getVmIndex (domIndex) {
      const indexes = this.visibleIndexes
      const numberIndexes = indexes.length
      return domIndex > numberIndexes - 1 ? numberIndexes : indexes[domIndex]
    },

    getComponent () {
      return this.$slots.default[0].componentInstance
    },

    resetTransitionData (index) {
      if (!this.noTransitionOnDrag || !this.transitionMode) {
        return
      }
      var nodes = this.getChildrenNodes()
      nodes[index].data = null
      const transitionContainer = this.getComponent()
      transitionContainer.children = []
      transitionContainer.kept = undefined
    },

    onDragStart (evt, range, slots) {
      this.context = this.getUnderlyingVm(evt.item)
      evt.item._underlying_vm_ = this.clone(this.context.element)
      draggingElement = evt.item

      this.draggingIndex = evt.oldIndex
      this.draggingRealIndex = range.start + evt.oldIndex
      this.draggingVNode = slots[evt.oldIndex]
      console.log(this.draggingIndex, this.draggingRealIndex, slots)
    },

    onDragAdd (evt) {
      const element = evt.item._underlying_vm_
      if (element === undefined) {
        return
      }
      removeNode(evt.item)
      const newIndex = this.getVmIndex(evt.newIndex)
      this.spliceList(newIndex, 0, element)
      this.computeIndexes()
      const added = { element, newIndex }
      this.emitChanges({ added })
    },

    onDragRemove (evt) {
      insertNodeAt(this.rootContainer, evt.item, evt.oldIndex)
      if (evt.pullMode === 'clone') {
        removeNode(evt.clone)
        return
      }
      const oldIndex = this.context.index
      this.spliceList(oldIndex, 1)
      const removed = { element: this.context.element, oldIndex }
      this.resetTransitionData(oldIndex)
      this.emitChanges({ removed })
    },

    onDragUpdate (evt) {
      removeNode(evt.item)
      insertNodeAt(evt.from, evt.item, evt.oldIndex)
      const oldIndex = this.context.index
      const newIndex = this.getVmIndex(evt.newIndex)

      this.updatePosition(oldIndex, newIndex)
      const moved = { element: this.context.element, oldIndex, newIndex }
      this.emitChanges({ moved })
    },

    updateProperty (evt, propertyName) {
      Object.prototype.hasOwnProperty.call(evt, propertyName) &&
        (evt[propertyName] += this.headerOffset)
    },

    computeFutureIndex (relatedContext, evt) {
      if (!relatedContext.element) {
        return 0
      }
      const domChildren = [...evt.to.children].filter(
        el => el.style.display !== 'none'
      )
      const currentDOMIndex = domChildren.indexOf(evt.related)
      const currentIndex = relatedContext.component.getVmIndex(currentDOMIndex)
      const draggedInList = domChildren.indexOf(draggingElement) !== -1
      return draggedInList || !evt.willInsertAfter
        ? currentIndex
        : currentIndex + 1
    },

    onDragMove (evt, originalEvent) {
      const onMove = this.move
      if (!onMove || !this.realList) {
        return true
      }

      const relatedContext = this.getRelatedContextFromMoveEvent(evt)
      const draggedContext = this.context
      const futureIndex = this.computeFutureIndex(relatedContext, evt)
      Object.assign(draggedContext, { futureIndex })
      const sendEvt = Object.assign({}, evt, {
        relatedContext,
        draggedContext
      })
      return onMove(sendEvt, originalEvent)
    },

    onDragEnd () {
      this.computeIndexes()
      draggingElement = null

      this.draggingVNode = null
    },

    findRealItem (item) {
      const idx = this.dataSources.findIndex(
        (x) => x[this.dataKey] === item[this.dataKey])
      return this.dataSources[this.visibleRange.start + idx]
    },

    updatedSources (
      instruction,
      draggingRealIndex) {
      const newList = [...this.dataSources]

      if ('moved' in instruction) {
        const { newIndex } = instruction.moved
        const start = this.visibleRange.start + newIndex
        const deleteCount = 0
        const item = newList.splice(draggingRealIndex, 1)[0]
        console.log(`Move by splicing start: ${start},` +
                     ` deleteCount: ${deleteCount}, item:`, item)
        newList.splice(start, deleteCount, item)
      } else if ('added' in instruction) {
        const { newIndex, element } = instruction.added
        const start = this.visibleRange.start + newIndex
        const deleteCount = 0
        const item = element
        console.log(`Add by splicing start: ${start},` +
                     ` deleteCount: ${deleteCount}, item:`, item)
        newList.splice(start, deleteCount, item)
      } else if ('removed' in instruction) {
        const { oldIndex } = instruction.removed
        const start = this.visibleRange.start + oldIndex
        const deleteCount = 1
        console.log(`Remove by splicing start: ${start},` +
                     ` deleteCount: ${deleteCount}`)
        newList.splice(start, deleteCount)
      }

      return newList
    }
  },

  // render function, a closer-to-the-compiler alternative to templates
  // https://vuejs.org/v2/guide/render-function.html#The-Data-Object-In-Depth
  render (h) {
    const { padFront, padBehind } = this.range
    const { isHorizontal, pageMode, rootTag, wrapTag, wrapClass, wrapStyle } = this
    const paddingStyle = { padding: isHorizontal ? `0px ${padBehind}px 0px ${padFront}px` : `${padFront}px 0px ${padBehind}px` }
    const wrapperStyle = wrapStyle ? Object.assign({}, wrapStyle, paddingStyle) : paddingStyle

    // draggable
    const slots = this.$slots.default
    this.transitionMode = isTransition(slots)
    const { headerOffset, footerOffset } = computeChildrenAndOffsets(
      slots,
      this.$slots,
      this.$scopedSlots
    )
    this.headerOffset = headerOffset
    this.footerOffset = footerOffset
    const attributes = getComponentAttributes(this.$attrs, this.componentData)

    return h(rootTag, {
      ref: 'root',
      on: {
        '&scroll': !pageMode && this.onScroll,
        input: this.$emit.bind(this, 'input'),
        start: (e) => {
          this.onDragStart(e, this.range, this.getRenderSlots(h))
          this.$emit('start', e)
        },

        end: (e) => {
          this.onDragEnd()
          this.$emit('end', e)
        },
        change: (e) => {
          if (draggableEvents.some(n => n in e)) {
            // this.$emit('input', draggablePolicy.updatedSources(
            //   e, this.vlsPolicy.draggingRealIndex));
          }
        }
      },
      ...attributes
    }, [
      // main list
      h(wrapTag, {
        class: wrapClass,
        attrs: {
          role: 'group'
        },
        style: wrapperStyle
      }, this.getRenderSlots(h)),

      // an empty element use to scroll to bottom
      h('div', {
        ref: 'shepherd',
        style: {
          width: isHorizontal ? '0px' : '100%',
          height: isHorizontal ? '100%' : '0px'
        }
      })
    ])
  }
})

export default VirtualList
