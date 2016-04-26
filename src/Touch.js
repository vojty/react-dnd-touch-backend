/**
 * Copyright 2015, Yahoo Inc.
 * Copyrights licensed under the MIT License. See the accompanying LICENSE file for terms.
 */
'use strict';

import invariant from 'invariant';

function getEventClientTouchOffset (e) {
    if (e.targetTouches.length === 1) {
        return getEventClientOffset(e.targetTouches[0]);
    }
}

function getEventClientOffset (e) {
    if (e.targetTouches) {
        return getEventClientTouchOffset(e);
    } else {
        return {
            x: e.clientX,
            y: e.clientY
        };
    }
}

const ELEMENT_NODE = 1;
function getNodeClientOffset (node) {
    const el = node.nodeType === ELEMENT_NODE
        ? node
        : node.parentElement;

    if (!el) {
        return null;
    }

    const { top, left } = el.getBoundingClientRect();
    return { x: left, y: top };
}

const eventNames = {
    mouse: {
        start: 'mousedown',
        move: 'mousemove',
        end: 'mouseup',
        click: 'click'
    },
    touch: {
        start: 'touchstart',
        move: 'touchmove',
        end: 'touchend'
    }
};

function getNodesAtOffset(nodes, clientOffset) {
    return Object.keys(nodes)
        .filter((nodeId) => {
            const boundingRect = nodes[nodeId].getBoundingClientRect();
            return clientOffset.x >= boundingRect.left &&
                clientOffset.x <= boundingRect.right &&
                clientOffset.y >= boundingRect.top &&
                clientOffset.y <= boundingRect.bottom;
        });
}

function getDistance(p1, p2) {
    const a = p1.x - p2.x;
    const b = p1.y - p2.y;
    return Math.sqrt(a * a + b * b);
}

export class TouchBackend {
    constructor (manager, options = {}) {
        options = {
            enableTouchEvents: true,
            enableMouseEvents: false,
            delay: 0,
            ...options
        };

        this.actions = manager.getActions();
        this.monitor = manager.getMonitor();
        this.registry = manager.getRegistry();

        this.delay = options.delay;
        this.sourceNodes = {};
        this.sourceNodeOptions = {};
        this.sourcePreviewNodes = {};
        this.sourcePreviewNodeOptions = {};
        this.moveStartSourceIds = {};
        this.targetNodes = {};
        this.targetNodeOptions = {};
        this.listenerTypes = [];
        this._mouseClientOffset = null;

        if (options.enableMouseEvents) {
            this.listenerTypes.push('mouse');
        }

        if (options.enableTouchEvents) {
            this.listenerTypes.push('touch');
        }

        this.getSourceClientOffset = this.getSourceClientOffset.bind(this);
        this.handleTopMoveStart = this.handleTopMoveStart.bind(this);
        this.handleTopMoveStartDelay = this.handleTopMoveStartDelay.bind(this);
        this.handleTopMoveStartCapture = this.handleTopMoveStartCapture.bind(this);
        this.handleTopMoveCapture = this.handleTopMoveCapture.bind(this);
        this.handleTopMoveEndCapture = this.handleTopMoveEndCapture.bind(this);
    }

    startHandler() {
        return this.delay ? this.handleTopMoveStartDelay : this.handleTopMoveStart;
    }

    setup () {
        if (typeof window === 'undefined') {
            return;
        }

        invariant(!this.constructor.isSetUp, 'Cannot have two Touch backends at the same time.');
        this.constructor.isSetUp = true;

        this.addEventListener(window, 'start', this.startHandler());
        this.addEventListener(window, 'start', this.handleTopMoveStartCapture, true);
        this.addEventListener(window, 'move',  this.handleTopMoveCapture, true);
        this.addEventListener(window, 'end',   this.handleTopMoveEndCapture, true);
    }

    teardown () {
        if (typeof window === 'undefined') {
            return;
        }

        this.constructor.isSetUp = false;
        this._mouseClientOffset = null;

        this.removeEventListener(window, 'start', this.startHandler());
        this.removeEventListener(window, 'start', this.handleTopMoveStartCapture, true);
        this.removeEventListener(window, 'move',  this.handleTopMoveCapture, true);
        this.removeEventListener(window, 'end',   this.handleTopMoveEndCapture, true);
    }

    addEventListener (subject, event, handler, capture) {
        this.listenerTypes.forEach(function (listenerType) {
            let eventName = eventNames[listenerType][event];
            if (eventName) {
                subject.addEventListener(eventName, handler, capture);
            }
        });
    }

    removeEventListener (subject, event, handler, capture) {
        this.listenerTypes.forEach(function (listenerType) {
            let eventName = eventNames[listenerType][event];
            if (eventName) {
                subject.removeEventListener(eventName, handler, capture);
            }
        });
    }

    connectDragSource (sourceId, node, options) {
        const handleMoveStart = this.handleMoveStart.bind(this, sourceId);
        const handleCancelClick = this.handleCancelClick.bind(this, sourceId);

        this.sourceNodes[sourceId] = node;

        this.addEventListener(node, 'start', handleMoveStart);
        this.addEventListener(node, 'click', handleCancelClick, true);

        return () => {
            delete this.sourceNodes[sourceId];
            this.removeEventListener(node, 'start', handleMoveStart);
            this.removeEventListener(node, 'click', handleCancelClick, true);
        };
    }

    connectDragPreview (sourceId, node, options) {
        this.sourcePreviewNodeOptions[sourceId] = options;
        this.sourcePreviewNodes[sourceId] = node;

        return () => {
            delete this.sourcePreviewNodes[sourceId];
            delete this.sourcePreviewNodeOptions[sourceId];
        };
    }

    connectDropTarget (targetId, node) {
        this.targetNodes[targetId] = node;

        return () => {
            delete this.targetNodes[targetId];
        };
    }

    getSourceClientOffset (sourceId) {
        return getNodeClientOffset(this.sourceNodes[sourceId]);
    }

    handleTopMoveStartCapture (e) {
        this.moveStartSourceIds = {};
    }

    handleMoveStart (sourceId) {
        this.moveStartSourceIds[sourceId] = true;
    }

    handleCancelClick (sourceId, e) {
        if (this.moveStartSourceIds[sourceId]) {
            e.stopPropagation();
        }
    }

    handleTopMoveStart (e) {
        const clientOffset = getEventClientOffset(e);
        if (clientOffset && getNodesAtOffset(this.sourceNodes, clientOffset).length > 0) {
            this._mouseClientOffset = clientOffset;

            // note: calling preventDefault here, seems to be the only way to defeat text selection in Safari
            // to handle other browsers, we could just call window.getSelection().removeAllRanges();
            if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
            }
        }
    }

    handleTopMoveStartDelay (e) {
        this.timeout = setTimeout(this.handleTopMoveStart.bind(this, e), this.delay);
    }

    handleTopMoveCapture (e) {
        clearTimeout(this.timeout);

        const clientOffset = getEventClientOffset(e);
        if (!clientOffset) {
            return;
        }

        // If we're not dragging and we've moved a little, that counts as a drag start
        if (!this.monitor.isDragging()) {
            if (
                this._mouseClientOffset &&
                getDistance(this._mouseClientOffset, clientOffset) > 2
            ) {
                const sourceIdsArray = Object.keys(this.moveStartSourceIds);
                if (sourceIdsArray.length > 0) {
                    e.preventDefault();

                    this.actions.beginDrag(sourceIdsArray, {
                        clientOffset: this._mouseClientOffset,
                        getSourceClientOffset: this.getSourceClientOffset,
                        publishSource: false
                    });

                    this._mouseClientOffset = null;
                }
            }

            return;
        }

        this.actions.publishDragSource();

        e.preventDefault();

        const matchingTargetIds = getNodesAtOffset(this.targetNodes, clientOffset);
        this.actions.hover(matchingTargetIds, { clientOffset });
    }

    handleTopMoveEndCapture (e) {
        if (!this.monitor.isDragging() || this.monitor.didDrop()) {
            this.moveStartSourceIds = {};
            return;
        }

        e.preventDefault();

        this._mouseClientOffset = null;

        this.actions.drop();
        this.actions.endDrag();
    }
}

export default function createTouchBackend (optionsOrManager = {}) {
    const touchBackendFactory = function (manager) {
        return new TouchBackend(manager, optionsOrManager);
    };

    if (optionsOrManager.getMonitor) {
        return touchBackendFactory(optionsOrManager);
    } else {
        return touchBackendFactory;
    }
}
