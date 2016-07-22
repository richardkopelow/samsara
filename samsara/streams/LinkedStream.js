/* Copyright © 2015-2016 David Valdman */
define(function(require, exports, module){
    var Stream = require('./Stream');
    var SimpleStream = require('./SimpleStream');
    var Observable = require('./Observable');
    var EventHandler = require('../events/EventHandler');

    var preTickQueue = require('../core/queues/preTickQueue');
    var dirtyQueue = require('../core/queues/dirtyQueue');

    function ReduceNode(reducer, stream, extras){
        this._input = new SimpleStream();

        var sources = [this._input, stream];
        if (extras) sources = sources.concat(extras);

        this._output = Stream.lift(reducer, sources);

        this.input = new SimpleStream();
        this.output = new SimpleStream();

        this.stream = stream;

        EventHandler.setInputHandler(this, this._input);
        EventHandler.setOutputHandler(this, this._output);
    }

    ReduceNode.prototype.setMap = function(map){
        this._output.setMap(map);
    };

    function LinkedList(reducer, offset, extras){
        this.reducer = reducer;
        this.prevReducer = function(){
            arguments[0] *= -1;
            return -reducer.apply(null, arguments);
        };

        this.offset = (offset === undefined || typeof offset === 'number')
            ? new Observable(offset || 0)
            : offset;

        this.cachedOffset = 0;
        this.offset.on('start', function(value){
            console.log('hello start', value)
            this.cachedOffset = value;
        }.bind(this));

        this.offset.on('update', function(value){
            this.cachedOffset = value;
        }.bind(this));

        this.offset.on('end', function(value){
            console.log('hello end', value)
            this.cachedOffset = value;
        }.bind(this));

        this.extras = extras;

        this.prev = [];
        this.next = [];

        this.tailOutput = new SimpleStream();
        this.tailOutput.subscribe(this.offset);

        this.headOutput = new SimpleStream();
        this.headOutput.subscribe(this.offset);

        this.pivotOutput = new SimpleStream();
        this.pivotOutput.subscribe(this.offset);
    }

    function fireOffset(){
        if (this.offset instanceof Observable){
            this.offset.set(this.offset.get());
        }
        else {
            var self = this;
            preTickQueue.push(function(){
                self.offset.emit('start', self.cachedOffset);
                dirtyQueue.push(function(){
                    self.offset.emit('end', self.cachedOffset);
                });
            });
        }
    }

    LinkedList.prototype.push = function(stream){
        var node = new ReduceNode(this.reducer, stream, this.extras);
        node.input.subscribe(node._output);
        node.output.subscribe(node._input);

        if (this.next.length === 0){
            node.subscribe(this.offset);
            setPivotOutput.call(this, node);
            fireOffset.call(this);
        }
        else {
            node.subscribe(this.next[this.next.length - 1]);
        }

        this.next.push(node);
        setHeadOutput.call(this, node);

        return node.output;
    };

    LinkedList.prototype.unshift = function(stream){
        var node = new ReduceNode(this.prevReducer, stream, this.extras);
        node.input.subscribe(node._input);
        node.output.subscribe(node._output);

        if (this.prev.length === 0){
            node.subscribe(this.offset);
            fireOffset.call(this);
        }
        else {
            node.subscribe(this.prev[this.prev.length - 1]);
        }

        this.prev.push(node);
        setTailOutput.call(this, node);

        return node.output;
    };

    LinkedList.prototype.pop = function(){
        if (!this.next.length) return;

        var node = this.next.pop();
        var prev = (this.next.length === 0) ? this.offset : this.next[this.next.length - 1];
        node.unsubscribe(prev);
        setHeadOutput.call(this, prev);

        return node;
    };

    LinkedList.prototype.shift = function(){
        if (!this.prev.length) return;

        var node = this.prev.shift();
        var next = (this.prev.length === 0) ? this.offset : this.prev[0];
        node.unsubscribe(next);
        setTailOutput.call(this, next);

        return node;
    };

    LinkedList.prototype.setPivot = function(index){
        if (index === 0) return;
        if (index > 0 && index > this.next.length) index = this.next.length;
        if (index < 0 && -index > this.prev.length) index = -this.prev.length;

        if (this.next[0]) this.next[0].unsubscribe(this.offset);
        if (this.prev[0]) this.prev[0].unsubscribe(this.offset);

        if (index > 0){
            for (var i = 0; i < index; i++){
                var next = this.next.shift();
                next.setMap(this.prevReducer);

                next.input.unsubscribe();
                next.input.subscribe(next._input);

                next.output.unsubscribe();
                next.output.subscribe(next._output);

                if (this.next[0]) this.next[0].unsubscribe(next);
                if (this.prev[0]) this.prev[0].subscribe(next);

                this.prev.unshift(next);
            }
        }
        else {
            for (var i = 0; i < -index; i++) {
                var prev = this.prev.shift();
                prev.setMap(this.reducer);

                prev.input.unsubscribe();
                prev.input.subscribe(prev._output);

                prev.output.unsubscribe();
                prev.output.subscribe(prev._input);

                if (this.prev[0]) this.prev[0].unsubscribe(prev);
                if (this.next[0]) this.next[0].subscribe(prev);

                this.next.unshift(prev);
            }
        }

        if (this.prev[0]) this.prev[0].subscribe(this.offset);
        if (this.next[0]) {
            this.next[0].subscribe(this.offset);
            setPivotOutput.call(this, this.next[0]);
        }

        fireOffset.call(this);
    };

    function setHeadOutput(head){
        this.headOutput.unsubscribe();
        this.headOutput.subscribe(head);
    }

    function setTailOutput(tail){
        this.tailOutput.unsubscribe();
        this.tailOutput.subscribe(tail);
    }

    function setPivotOutput(pivot){
        this.pivotOutput.unsubscribe();
        this.pivotOutput.subscribe(pivot.stream);
    }

    module.exports = LinkedList;
});
