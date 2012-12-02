// l8.js
//   Task/promise manager
//   https://github.com/JeanHuguesRobert/l8
//
// 2012/10/24, JHR, create

var L8 = null
var l8 = null

/* ----------------------------------------------------------------------------
 *  Debug
 */

var DEBUG = true
if( DEBUG ){

var de = true, bug = trace
// That's my de&&bug darling

var TraceStartTask = 0
// When debugging test cases, this tells when to start outputting traces

var Util = null
try{
  Util = require( "util")
  Util.debug( "entering l8.js")
}catch( e ){}

function trace(){
// Print trace. Offer an easy breakpoint when output contains "DEBUG"
  var buf = ["L8"]
  for( var ii = 0 ; ii < arguments.length ; ii++ ){
    if( arguments[ii] ){ buf.push( arguments[ii]) }
  }
  buf = buf.join( ", ")
  try{
    if( Util ){
      Util.puts( buf)
    }else{
      console.log( buf)
    }
    if( buf.indexOf( "DEBUG") >=  0 ){
      // please set breakpoint here to debug
      false && breakpoint()
    }
  }catch( e ){
    // ToDo: host adapted tracing
  }
  return buf
}

// When not in debug mode
}else{
  var de = false, bug = function(){} // noop for de&&bug()
  var TraceStartTask = 0
}

/* ----------------------------------------------------------------------------
 *  Task & Step
 */

function Task( parent ){
// Tasks are like function call activation records, but with a spaghetti stack
// because more than one child task can be active at the same time.
  this.id              = ++L8.taskCount
  if( DEBUG ) this.stepCount = 0  // Step ids generator
  this.firstStep       = null
  this.parentTask      = parent   // aka "caller"
  this.currentStep     = null     // What step the task is on, aka "IP"
  this.insertionStep   = null     // Where steps are usually added
  this.pausedStep      = null     // What step the task is paused on
  this.queuedTasks     = null     // Subtasks that block this task
  this.queuedTaskCount = 0        // ToDo: faster impl, linked list
  this.stepResult      = undefined
  this.stepError       = undefined
  this.isDone          = false    // False while task is pending
  this.optional        = {}
  /*
  this.optional.wasCanceled     = false    // "brutal cancel" flag
  this.optional.shouldStop      = false    // "gentle cancel" flag
  this.optional.successBlock    = null
  this.optional.failureBlock    = null
  this.optional.progressBlock   = null
  this.optional.finalBlock      = null
  this.optional.donePromise     = null
  */
  // Add new task to it's parent's list of pending subtasks
  this.subTasks        = null
  this.subTaskCount    = 0
  if( parent ){
    if( parent.subTasks ){
      parent.subTaskCount++
    }else{
      parent.subTasks = {}
      parent.subTaskCount = 1
    }
    // ToDo: faster implementation using doubly linked list
    parent.subTasks[this.id] = this
  }
  if( TraceStartTask && L8.taskCount >= TraceStartTask )trace( "New", this)
  return this
}
var ProtoTask = Task.prototype

var noop = function noop(){}

function Step( task, block ){
  if( DEBUG ) this.id = ++task.stepCount
  this.task        = task
  this.block       = block || noop
  this.isForked    = false
  this.isRepeated  = false
  this.isBlocking  = true   // When task is paused on this step
  // enqueue/dequeue list management
  this.previous    = null
  this.next        = null
  var previous = task.insertionStep
  task.insertionStep = this
  // When inserting at head
  if( !previous ){
    this.next      = task.firstStep
    if( this.next ){ this.next.previous = this }
    task.firstStep = task.currentStep = this
  // When inserting at tail
  }else if( !previous.next ){
    this.previous      = previous
    this.previous.next = this
  // When inserting in the middle of the list
  }else{
    this.previous = previous
    this.next     = previous.next
    previous.next.previous = this
    previous.next = this
  }
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    trace(
      "New", this,
      this === task.firstStep ? "first" : ""
    )
  }
  return this
}
var ProtoStep = Step.prototype

// Bootstrap root task, id 0
L8 = {taskCount:-1}
L8 = l8 = L8.L8 = L8.l8 = new Task()
L8.taskCount   = 0
L8.local       = {root:L8}
L8.queuedStep  = null
L8.stepQueue   = []
L8.isScheduled = false
var CurrentStep = new Step( L8)
L8.currentStep = L8.pausedStep = CurrentStep

// Browser & nodejs compatible way to schedule code exectution in event loop.
// Note: you can provide yours if you get an efficient one.
try{
  L8.nextTick = process.nextTick
  L8.nextTick( function(){})
}catch( e ){
  L8.nextTick = function next_tick( block ){ setTimeout( block, 0) }
  L8.nextTick( function(){})
}

// Some special errors are used to build control structures
L8.cancelEvent   = {l8:"cancel"}
L8.breakEvent    = {l8:"break"}
L8.continueEvent = {l8:"continue"}
L8.returnEvent   = {l8:"return"}
L8.failureEvent  = {l8:"failure"}
L8.closeEvent    = {l8:"close"}

/*
 *  Scheduler, aka "step walker"
 */

L8.scheduler = function scheduler(){
// Inject the global scheduler in the global event loop.
// It executes queued steps and their next ones.
  function tick(){
    L8.isScheduled = false
    var step
    while( step = L8.dequeueStep() ){
      step.execute()
      step.scheduleNext()
    }
    // When done, assume code runs from within the "root" task
    CurrentStep = L8.currentStep
  }
  if( !L8.isScheduled ){
    L8.nextTick( tick)
    L8.isScheduled = true
  }
}

L8.enqueueStep = function enqueue_step( step ){
// Schedule step to execute. Restart scheduler if it is not started.
  // Assert style check that step is not queued twice
  if( false ){
    if( step.wasQueued ){
      throw trace( "requeue bug: " + step)
    }
    step.wasQueued = true
  }
  // Store step, efficiently if only one exist, in an array if more is needed
  if( L8.stepQueue ){
    L8.stepQueue.push( step)
  }else{
    if( L8.queuedStep ){
      L8.stepQueue = [L8.queuedStep, step]
      L8.queuedStep = null
    }else{
      L8.queuedStep = step
    }
  }
  step.isBlocking = false
  // Wake up scheduler if necessary, it will eventually execute this step
  L8.scheduler()
  // Debug traces
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    if( L8.queuedStep ){
      L8.queuedStep.trace( "queued step")
    }else{
      var item
      for( var ii = 0 ; ii < L8.stepQueue.length ; ii++ ){
        item = L8.stepQueue[ii].trace( "queued step[" + ii + "]")
      }
    }
  }
}

L8.dequeueStep = function dequeue_step(){
// Consume first step from step queue.
  // Step is stored in an array only when more than one step is queued
  var queue = L8.stepQueue
  var step
  if( queue ){
    step = queue.shift()
    if( queue.length === 0 ){
      L8.stepQueue = null
    }
  }else{
    if( step = L8.queuedStep ){
      L8.queuedStep = null
    }
  }
  return step
}

ProtoStep.trace = function step_trace( msg ){
  var task = this.task
  trace(
    msg,
    this,
    task.isDone     ? "task done" : "",
    this === task.firstStep ? "first" : "",
    this.isRepeated ? "repeat" : "",
    this.isForked   ? "fork"   : "",
    this.isBlocking ? "pause"  : ""
  )
}

ProtoStep.execute = function step_execute(){
  var task         = this.task
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    this.trace( "DEBUG execute")
  }
  if( task.isDone )throw new Error( "BUG, execute a done l8 step: " + this)
  if( this.isBlocking )return
  task.currentStep = this
  // Steps created by this step are queued after the insertionStep
  task.insertionStep = this
  CurrentStep      = this
  var block = this.block
  var result
  // Execute block, set "this" to the current task
  try{
    // If step(), don't provide any parameter
    if( !block.length ){
      result = block.apply( task)
    // If step( r), provide last result as a single parameter
    }else if( block.length === 1 ){
      result = block.apply( task, [task.stepResult])
    // If step( a, b, ...), assume last result is an array
    }else{
      result = block.apply( task, task.stepResult)
    }
    // Update last result only when block returned something defined.
    // Result is set asynchronously using next(), see below
    if( result !== undefined ){
      task.stepResult = result
    }
    if( DEBUG ){ task.progressing() }
  }catch( e ){
    // scheduleNext() will handle the error propagation
    task.stepError = e
    if( TraceStartTask && L8.taskCount >= TraceStartTask ){
      this.trace( "DEBUG execute failed: " + e)
    }
  }finally{
    task.insertionStep = null
  }
}

ProtoStep.scheduleNext = function schedule_next(){
// Handle progression from step to step, error propagation, task termination
  var task = this.task
  if( task.isDone )throw new Error( "Bug, schedule a done l8 task: " + this)
  if( this.isBlocking )return
  var redo = this.isRepeated
  // Handle "continue" and "break" in loops
  if( redo && task.stepError ){
    if( task.stepError === L8.continueEvent ){
      task.stepError = undefined
    }else if( task.stepError === L8.breakEvent ){
      redo = false
    }
  }
  var queue = task.queuedTasks
  var subtasks
  var subtask_id
  var subtask
  // When no error, wait for subtask if any, else move to next step or loop
  if( !task.stepError ){
    var next_step = redo ? this : this.next
    if( next_step ){
      if( !this.isForked || !next_step.isForked || redo ){
        // Regular steps wait for subtasks, fork steps don't
        if( queue ){
          for( subtask in queue ){
            this.isBlocking = true
            task.pausedStep = this
            return
          }
        }
      }
      // If loop, don't block the global event loop
      if( redo ){
        L8.nextTick( function(){ L8.enqueueStep( next_step) })
      }else{
        L8.enqueueStep( next_step)
      }
      return
    }
    // When all steps are done, wait for spawn subtasks
    this.isBlocking = true
    task.pausedStep = this
    if( queue ){
      for( subtask in queue )return
    }
    if( subtasks = task.subTasks ){
      for( subtask_id in subtasks ){
        subtask = subtasks[subtask_id]
        if( subtask.isDone || (queue && queue[subtask.id]) )continue
        queue[subtask.id] = task
        task.queuedTaskCount++
        return
      }
    }
  // When error, cancel all remaining subtasks, both queued and spawn ones
  }else{
    if( queue ){
      for( subtask_id in queue ){
        queue[subtask_id].cancel()
      }
    }
    if( subtasks = task.subTasks ){
      for( subtask_id in subtasks ){
        subtasks[subtask_id].cancel()
      }
    }
    // ToDo: how can canceled tasks schedule some more steps?
  }
  // When nothing more, handle task termination
  this.isBlocking = true
  task.pausedStep = null
  // ToDo: let success/failure block run asynch, then done, not before
  task.isDone     = true
  var exit_repeat = false
  var block
  try{
    if( task.stepError === L8.returnEvent ){
      task.stepError = undefined
    }else if( task.stepError === L8.breakEvent ){
      task.stepError = undefined
      exit_repeat    = true
    }
    task.progressing()
    try{
      if( task.stepError ){
        if( block = task.optional.failureBlock ){
          try{
            block.call( task, task.stepError)
          }catch( e ){
            throw e
          }
        }else{
          throw task.stepError
        }
      }else{
        if( block = task.optional.successBlock ){
          try{
            block.call( task, task.stepResult)
          }catch( e ){
            throw e
          }
        }
      }
    }catch( e ){
      task.stepError = e
      throw e
    }finally{
      try{
        if( block = task.optional.finalBlock ){
          try{
            block.call( task, task.stepError, task.stepResult)
          }catch( e ){
            task.stepError = e
            throw e
          }
        }
      }finally{
        var err  = task.stepError
        var promise = task.optional.donePromise
        if( promise ){
          if( err ){
            promise.reject( err)
          }else{
            promise.resolve( rslt)
          }
        }
      }
    }
  }catch( e ){
    task.stepError = e
    if( !task.parentTask === L8 ){
      task.parentTask.raise( e)
    }else{
      throw e
    }
  }finally{
    try{
      if( exit_repeat && task.parentTask ){
        if( task.parentTask.currentStep.isRepeated ){
          task.parentTask.currentStep.isRepeated = false
        }else{
          task.stepError = L8.breakEvent
          task.parentTask.raise( L8.breakEvent)
        }
      }
    }finally{
      if( task.parentTask ){ task.parentTask.subtaskDoneEvent( task) }
    }
  }
}

ProtoTask.subtaskDoneEvent = function subtask_done_event( subtask ){
// Private. Called by .execute() when task is done
  var task = this
  delete task.subTasks[subtask.id]
  if( --task.subTaskCount === 0 ){
    task.subTasks = null
  }
  if( task.queuedTasks
  &&  task.queuedTasks[subtask.id]
  ){
    delete task.queuedTasks[subtask.id]
    if( --task.queuedTaskCount === 0 ){
      task.queuedTasks = null
      if( task.pausedStep ){
        task.stepResult = subtask.stepResult
        task.resume()
      }
      // ToDo: error propagation
    }
  }
}

ProtoTask.enqueueTask = function task_enqueue_task( task ){
  if( this === L8 )return
  if( this.queuedTasks ){
    this.queuedTaskCount++
  }else{
    this.queuedTasks = {}
    this.queuedTaskCount = 1
  }
  this.queuedTasks[task.id] = task
}

ProtoTask.step = function step( block, is_forked, is_repeated ){
// Add a step to execute later
  var task = this.current
  if( task.isDone )throw new Error( "Can't add new step, l8 task is done")
  if( !(block instanceof Function) ){
    block = function(){ task.interpret( block) }
  }
  var step = new Step( task, block)
  if( is_forked   ){ step.isForked   = true }
  if( is_repeated ){ step.isRepeated = true }
  return task
}

ProtoTask.next = function task_next( block ){
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    // ToDo: test/allow multiple next()
    // throw new Error( "Can't walk, not running")
  }
  step.isBlocking = true
  return function walk_cb(){
    if( task.currentStep !== step ){
      // ToDo: quid if multiple next() fire?
      // throw new Error( "Cannot walk same step again")
    }
    var previous_step = CurrentStep
    CurrentStep = step
    var result
    if( arguments.length === 1 ){
      result = arguments[0]
    }else{
      result = arguments
    }
    try{
      // ToDo: block should run as if from next step ?
      // ToDo: block should run as a new step ?
      if( block ){
        result = block.apply( task, arguments)
      }
      if( task.currentStep === step ){
        if( step.isBlocking ){
          task.stepResult = result
          step.isBlocking = false
          step.scheduleNext()
        }
      }
    }catch( e ){
      task.raise( e)
    }finally{
      CurrentStep = previous_step
      L8.scheduler()
    }
  }
}

ProtoTask.__defineGetter__( "walk", function(){
  return this.next( null)
})


/*
 *  API
 */

ProtoTask.Task = function task_task( fn ){
// Build a "task constructor". When such a beast is called, it creates a task
  if( !(fn instanceof Function) ){
    var block
    if( !(fn instanceof Array) || arguments.length > 1 ){
      block = Array.prototype.slice.call( arguments, 0)
    }else{
      block = fn
    }
    fn = function(){ this.interpret( block) }
  }
  return function (){
    var parent_task = CurrentStep.task.isDone ? L8 : CurrentStep.task
    var task = new Task( parent_task)
    parent_task.enqueueTask( task)
    var args = arguments
    new Step( task, function(){
      return fn.apply( task, args)
    })
    L8.enqueueStep( task.firstStep)
    return task
  }
}

ProtoTask.toString = function task_to_string(){ return "Task " + this.id }

ProtoTask.__defineGetter__( "current", function(){
  return this === L8 ? CurrentStep.task : this
})

ProtoTask.__defineGetter__( "begin", function(){
  return new Task( this.current)
})

ProtoTask.__defineGetter__( "end", function(){
  var task  = this
  var first = task.firstStep
  if( !first ){
    new Step( task)
  }
  // When first step can run immediately
  if( !task.queuedTaskCount ){
    L8.enqueueStep( task.firstStep)
  // When first step is after forks
  }else{
    // Pause task to wait for forks, need a new "first step" for that
    if( first ){
      var save = task.insertionStep
      task.insertionStep = null
      new Step( task)
      task.insertionStep = save
    }
    task.pausedStep = task.firstStep
  }
  // Return parent, makes chaining possible t.begin.step().step().end.step()
  return task.parentTask
})

ProtoTask.__defineGetter__( "done", function(){
  return this.current.isDone
})

ProtoTask.__defineGetter__( "succeed", function(){
  var task = this.current
  return task.isDone && !task.err
})

ProtoTask.__defineGetter__( "fail", function(){
  var task = this.current
  return task.isDone && task.err
})

ProtoTask.__defineGetter__( "result", function(){
  return this.current.stepResult
})

ProtoTask.__defineSetter__( "result", function( val){
  return this.current.stepResult = val
})

ProtoTask.__defineGetter__( "error", function(){
  return this.current.stepError
})

ProtoTask.__defineGetter__( "stop", function(){
  var task = this.current
  task.optional.shouldStop = true
  return task
})

ProtoTask.__defineGetter__( "stopping", function(){
  var task = this.current
  return task.optional.shouldStop && !task.isDone
})

ProtoTask.__defineGetter__( "stopped", function(){
  var task = this.current
  return task.optional.shouldStop && task.isDone
})

ProtoTask.__defineGetter__( "canceled", function(){
  return this.current.optional.wasCanceled
})

ProtoTask.task = function task_task( block, forked, paused, detached, repeat ){
// Add a step that will start a new task with some initial step to execute
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    trace( this.current.currentStep , "invokes fork()",
      forked   ? "forked"   : "",
      paused   ? "paused"   : "",
      detached ? "detached" : "",
      repeat   ? "repeated" : ""
    )
  }
  return this.step( function(){
    var task = this.current
    if( TraceStartTask && L8.taskCount >= TraceStartTask ){
      trace( task.currentStep , "executes scheduled fork",
        forked   ? "forked"   : "",
        paused   ? "paused"   : "",
        detached ? "detached" : "",
        repeat   ? "repeated" : ""
      )
    }
    var new_task = new Task( task)
    if( !detached ){
      task.enqueueTask( new_task)
    }
    if( paused ){
      // Pause task, need a new "first step" for that
      new Step( new_task)
      new_task.pausedStep = new_task.firstStep
      new Step( new_task, block)
    }else{
      L8.enqueueStep( new Step( new_task, block))
    }
  }, forked, repeat)
}

ProtoTask.fork = function task_fork( block ){
// Add a step that will start a forked task with some initial step to execute
  return this.task( block, true)
}

ProtoTask.spawn = function task_spawn( block, starts_paused ){
// Add a step that will start a detached task with some initial step to execute
  return this.task( block, true, starts_paused, true) // detached
}

ProtoTask.repeat = function task_repeat( block ){
// Add a step that will repeately start a new task with a first step to execute
  return this.task( block, false, false, false, true) // repeated
}

ProtoTask.interpret = function task_interpret( steps ){
// Add steps according to description.
  var task = this.current
  var block
  for( step in steps ){
    if( step instanceof Function ){
      this.step( step)
    }else if( step instanceof Array ){
      this.task( step)
    }else{
      if( block = step.step     ){ this.step(     block) }
      if( block = step.task     ){ this.task(     block) }
      if( block = step.repeat   ){ this.repeat(   block) }
      if( block = step.fork     ){ this.fork(     block) }
      if( block = step.progress ){ this.progress( block) }
      if( block = step.success  ){ this.success(  block) }
      if( block = step.failure  ){ this.failure(  block) }
      if( block = step.final    ){ this.final(    block) }
    }
  }
  return task
}

ProtoTask.__defineGetter__( "tasks", function(){
  var buf = []
  var tasks = this.subTasks
  if( tasks ){
    for( var k in tasks ){
      buf.push( tasks[k])
    }
  }
  return buf
})

ProtoTask.__defineGetter__( "parent", function(){
  return this.current.parentTask
})

ProtoTask.__defineGetter__( "root", function(){
  var task = this.current
  if( !task.parentTask )return task
  while( true ){
    if( task.parentTask === L8 )return task
    task = task.parentTask
  }
})

ProtoTask.__defineGetter__( "paused", function(){
  var task = this.current
  return !!task.pausedStep
})

ProtoTask.cancel = function task_cancel(){
  var task    = this.current
  if( task.isDone )return task
  var done    = false
  var on_self = false
  while( !done ){
    done = true
    var tasks = task.tasks
    for( var subtask in tasks ){
      if( subtask.optional.wasCanceled )continue
      if( subtask.currentStep === CurrentStep ){
        on_self = subtask
      }else{
        done = false
        subtask.cancel()
      }
    }
  }
  if( !on_self && task !== CurrentStep.task ){
    task.optional.wasCanceled = true
    task.raise( L8.cancelEvent)
  }
  return task
}

ProtoTask.progressing = function task_progressing(){
  if( this.optional.progressBlock ){
    try{
      this.optional.progressBlock( this)
    }catch( e ){
      // ToDo
    }
  }
  if( this.promise ){
    this.promise.progress()
  }
}

ProtoTask._return = Task["return"] = function task_return( val ){
  var task = this.current
  if( task.isDone ){
    throw new Error( "Cannot _return, done l8 task")
  }
  task.stepResult = val
  task.raise( L8.returnEvent)
}
ProtoTask.__defineGetter__( "continue", function task_continue(){
  return this.raise( L8.continueEvent)
})

ProtoTask.__defineGetter__( "_break", function task__break(){
  return this.raise( L8.breakEvent)
})

ProtoTask.__defineGetter__( "break",  function task_break(){
  return this.raise( L8.breakEvent)
})

ProtoTask.__defineGetter__( "_continue", function task__continue(){
  return this.raise( L8.continueEvent)
})

ProtoTask.__defineGetter__( "continue", function task_continue(){
  return this.raise( L8.continueEvent)
})

ProtoStep.toString = function(){ return this.task.toString() + "/" + this.id }

ProtoTask.final = function final( block ){
  var task = this.current
  task.optional.finalBlock = block
  return task
}

ProtoTask.finally = Task.final

ProtoTask.failure = function failure( block ){
  var task = this.current
  task.optional.failureBlock = block
  return task
}

ProtoTask.catch = Task.failure

ProtoTask.success = function success( block ){
  var task = this.current
  task.optional.successBlock = block
  return task
}

/* ----------------------------------------------------------------------------
 *  Trans-compiler
 */

ProtoTask.compile = function task_compile( code ){
// Expand some macros to make a "task constructor".

  // Lexer

  code = code.toString()
  var close = code.lastIndexOf( "}")
  code = code.substr( 0, close) + code.substr( close + 1)
  code = "\n begin;\n" + code + "\n end;\n"
  var ii = 0
  var fragment
  var fragments = []
  code.replace(
    / (begin|end|step;|step\([^\)]*\);|task;|fork;|repeat;|progress;|success;|failure;|final;)/g,
    function( match, keyword, index ){
      fragment = code.substring( ii, index - 1)
      fragments.push( fragment)
      fragment = "~kw~" + keyword
      fragments.push( fragment)
      ii = index + match.length
    }
  )

  // Parser

  function is_empty( code ){
    return !code
    .replace( /;/g,  "")
    .replace( /\./g, "")
    .replace( /\s/g, "")
    .replace( /\r/g, "")
    .replace( /\n/g, "")
  }

  function parse( list, subtree, is_nested ){
    var obj
    var kw
    var params
    if( !list.length )return subtree
    var head = list.shift()
    // trace( head)
    if( head == "~kw~end" ){
      if( !is_nested ){
        throw new Error( "Unexpected 'end' in L8.compile()")
      }
      return subtree
    }
    if( head == "~kw~begin" ){
      var sub = parse( list, [], true)
      subtree.push( {begin: sub})
    }else if( head.indexOf( "~kw~") === 0 ){
      kw = head.substr( 4).replace( ";", "").replace( /\s/g, "")
      params = ""
      kw = kw.replace( /\(.*\)/, function( match ){
        params = match
        return ""
      })
      obj = {params:params}
      obj[kw] = list.shift()
      subtree.push( obj)
    }else{
      subtree.push( {code:head})
    }
    return parse( list, subtree, is_nested)
  }

  var tree = parse( fragments, [], false)
  var body = tree[1].begin
  var head = body[0].code.replace( /;\nfunction/, "function")
  delete body[0]

  // Code generator

  var pushed

  function f( params, code ){
    params = params || "()"
    return "function" + params + "{ "
    + code.replace( / +/g, " ").replace( /(\r|\n| )+$/, "")
    + " }"
  }

  function g( buf, kw, params, code ){
    if( is_empty( code) ){
      pushed = true
      return ""
    }
    //buf.push( "this." + kw + "( " + f( code) + ");\n")
    buf.push( kw + "( " + f( params, code) + ")")
    pushed = true
  }

  var previous = null

  function gen_block( head, buf, after ){
    if( !head )return
    var block
    if( block = head.begin ){
      var body_obj = []
      previous = null
      generate( block, body_obj)
      body_obj = body_obj.join( ".\n")
      if( after && (after.fork || after.repeat || after.spawn) ){
        buf.push( body_obj)
        pushed = true
        return
      }
      // "begin" after "step" is equivalent to "task"
      if( after && after.step ){
        buf.push( body_obj)
        pushed = true
        return
      }
      g( buf, "task", "()", body_obj)
    }
    else if( block = head.code     ){
      if( !is_empty( block) ){
        buf.push( block + "\nthis")
      }
      pushed = true
    }
    else if( block = head.step     ){ g( buf, "step",     head.params, block) }
    else if( block = head.task     ){ g( buf, "task",     head.params, block) }
    else if( block = head.fork     ){ g( buf, "fork",     head.params, block) }
    else if( block = head.spawn    ){ g( buf, "spawn",    head.params, block) }
    else if( block = head.repeat   ){ g( buf, "repeat",   head.params, block) }
    else if( block = head.progress ){ g( buf, "progress", head.params, block) }
    else if( block = head.success  ){ g( buf, "success",  head.params, block) }
    else if( block = head.failure  ){ g( buf, "failure",  head.params, block) }
    else if( block = head.final    ){ g( buf, "final",    head.params, block) }
  }

  function generate( tree, buf ){
    if( !tree.length ){
      gen_block( previous, buf)
      return
    }
    var head = tree.shift()
    if( !head )return generate( tree, buf)
    var block
    pushed = false
    if( head.begin && previous ){
      var content
      for( var kw in previous ){
        if( kw == "params" )continue
        content = previous[kw]
      }
      if( is_empty( content) ){
        content = []
        var tmp = previous
        gen_block( head, content, previous)
        previous = tmp
        for( kw in previous ){
          if( kw == "params" )continue
          // "step" + "begin" eqv "task"
          if( kw == "step" ){
            previous["step"] = null
            kw = "task"
          }
          previous[kw] = content.join( ".\n")
        }
        head = null
      }
    }
    if( previous ){
      gen_block( previous, buf)
      if( !pushed ){
        //g( buf, "step", previous.code)
        if( !is_empty( previous.code) ){
          buf.push( previous.code  + ";this")
        }
        pushed = true
      }
    }
    previous = head
    generate( tree, buf)
  }

  //trace( Util.inspect( fragments))
  var str  = []
  str.push( head + ";this")
  generate( body, str)
  trace( Util.inspect( str))
  str = str.join( ".\n") + "}"
  var fn
  eval( "fn = " + str)
  return L8.Task( fn)
}

if( DEBUG ){
function do_something_as_task(){
    var ii = 0
    step; this.sleep( 1000);
    fork; do_some_other_task();
    fork; another_task();
    task; yet();
    step( a, b ); use( a); use( b);
    step; begin
      ii++
      step; ha()
    end
    fork; begin
      first()
      failure; bad()
    end
    fork; begin
      step; second()
      failure; very_bad()
    end
    begin
      step; ok()
      failure; ko()
    end
    repeat; begin
      step; act()
      step( r ); if( !r ) this.break
    end
    success; done();
    failure; problem();
    final;   always();
}
trace( L8.compile( do_something_as_task))
} // DEBUG

/* ----------------------------------------------------------------------------
 *  Promise
 */

ProtoTask.then = function task_then( success, failure, progress ){
  var promise = this.optional.donePromise
  if( !promise ){
    promise = this.optional.donePromise = new Promise()
  }
  return promise.then( success, failure, progress)
}

function Promise( resolved, rejected ){
// Promise/A compliant. See https://gist.github.com/3889970
  if( resolved && rejected )throw new Error( "inconsistent promise")
  this.wasResolved   = !!resolved
  this.resolveValue  = resolved
  this.wasRejected   = !!rejected
  this.rejectReason  = rejected
  this.allHandlers   = null
  return this
}
ProtoPromise = Promise.prototype

ProtoTask.__defineGetter__( "promise", function task_promise(){
  return new Promise()
})

ProtoPromise.then = function promise_then( success, failure, progress ){
  var new_promise = new Promise()
  if( !this.allHandlers ){
    this.allHandlers = []
  }
  this.allHandlers.push({
    successBlock:  success,
    failureBlock:  failure,
    progressBlock: progress,
    nextPromise:   new_promise
  })
  if( this.wasResolved ){
    this.resolve( this.resolveValue, true) // force
  }else if( this.wasRejected ){
    this.reject( this.rejectReason, true)  // force
  }
  return new_promise
}

ProtoPromise.handleResult =  function handle( handler, ok, value ){
  var block = ok ? handler.successBlock : handler.failureBlock
  var next  = handler.nextPromise
  if( block ){
    try{
      var val = block.call( this, value)
      if( val && val.then ){
        val.then(
          function( r ){ ProtoPromise.handleResult( handler, true,  r) },
          function( e ){ ProtoPromise.handleResult( handler, false, e) }
        )
        return
      }
      if( next ){
        next.resolve( val)
      }
    }catch( e ){
      if( next ){
        next.reject( e)
      }
    }
  }else if( next ){
    next.resolve.call( next, value)
  }
  handler.nextPromise = null
  handler.failureBlock = handler.successBlock = handler.progressBlock = null
}

ProtoPromise.resolve = function promise_resolve( value, force ){
  if( !force && (this.wasResolved || this.wasRejected) )return
  this.wasResolved  = true
  this.resolveValue = value
  if( !this.allHandlers )return
  for( var ii = 0 ; ii < this.allHandlers.length ; ii++ ){
    var handler = this.allHandlers[ii]
    (function( handler ){
      L8.nextTick( function(){
        ProtoPromise.handleResult( handler, true, value)
      })
    })( handler)
  }
  this.allHandlers = null
  return this
}

ProtoPromise.reject = function promise_reject( value, force ){
  if( !force && (this.wasResolved || this.wasRejected) )return
  this.wasRejected  = true
  this.rejectReason = value
  if( !this.allHandlers )return
  for( var ii = 0 ; ii < this.allHandlers.length ; ii++ ){
    var handler = this.allHandlers[ii]
    (function( handler ){
      L8.nextTick( function(){
        ProtoPromise.handleResult( handler, false, value)
      })
    })( handler)
  }
  this.allHandlers = null
  return this
}

ProtoPromise.progress = function promise_progress(){
  if( this.wasResolved || this.wasRejected )return
  // ToDo: implement this
  return this
}

/* ----------------------------------------------------------------------------
 *  Tasks synchronization
 */

ProtoTask.wait = function task_wait( promise ){
  var task = this.current
  var step = task.currentStep
  task.pause()
  promise.then(
    function( r ){
      if( !task.currentStep === step )return
      task.resume()
    },
    function( e ){
      if( !task.currentStep === step )return
      task.raise( e)
    }
  )
  return task
}

ProtoTask.pause = function pause(){
// Pause execution of task at current step. Task will resume and execute next
// step when resume() is called.
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    throw new Error( "Cannot pause, already blocked l8 task")
  }
  step.isBlocking = true
  task.pausedStep = step
  return task
}

ProtoTask.resume = function task_resume(){
// Resume execution of paused task. Execution restarts at step next to the
// one where the task was paused.
  var task = this.current
  var paused_step = task.pausedStep
  if( !paused_step ){
    throw new Error( "Cannot resume, not paused l8 task")
  }
  if( !paused_step.isBlocking ){
    throw new Error( "Cannot resume, running l8 step")
  }
  task.pausedStep = null
  paused_step.isBlocking = false
  paused_step.scheduleNext()
  return task
}

ProtoTask.raise = function task_raise( err ){
  var task = this.current
  if( task.isDone )return
  err = task.stepError = err || task.stepError || L8.failureEvent
  if( task.pausedStep ){
    // If task waits for another one to yield, raise error in it too
    var yielding_task = task.yieldingTask
    if( yielding_task ){
      yielding_task.raise( err)
    }
    task.resume()
  }else{
    var step = task.currentStep
    if( step ){
      // If there exists subtasks, forward error to them
      var queue =  task.queuedTasks
      if( queue  ){
        for( var subask in queue ){
          queue[subtask].raise( err)
        }
        return
      }
      // error are forwarded to parent, unless catched, in scheduleNext()
      if( step.isBlocking ){
        step.isBlocking = false
        step.scheduleNext()
      }else if( step === CurrentStep ){
        throw err
      }
    }else{
      trace( "Unhandled exception", e, e.stack)
    }
  }
  return task
}

ProtoTask.throw = Task.raise

ProtoTask.sleep = function task_sleep( delay ){
  var task = this.current
  var step = task.currentStep
  task.pause()
  setTimeout( function() {
    if( !task.currentStep === step )return
    task.resume()
  }, delay)
  return task
}

/* ----------------------------------------------------------------------------
 *  Semaphore
 */

function Semaphore( count ){
  this.count        = count
  this.promiseQueue = []
  this.closed       = false
  return this
}
var ProtoSemaphore = Semaphore.prototype

ProtoTask.semaphore = function( count ){
  return new Semaphore( count)
}

ProtoSemaphore.then = function( callback ){
  return this.promise.then( callback)
}

ProtoSemaphore.__defineGetter__( "promise", function(){
  var promise = new Promise()
  if( this.closed ){
    promise.reject( L8.CloseEvent)
    return
  }
  if( this.count > 0 ){
    this.count--
    promise.resolve( this)
  }else{
    this.queue.push( promise)
  }
  return promise
})

ProtoSemaphore.release = function(){
  this.count++
  if( this.closed || this.count <= 0 )return
  var step = this.promiseQueue.shift()
  if( step ){
    this.count--
    step.resolve( this)
  }
  return this
}

ProtoSemaphore.close = function(){
  var list = this.promiseQueue
  this.promiseQueue = null
  var len = list.length
  for( var ii = 0 ; ii < len ; ii++ ){
    list[ii].reject( L8.CloseEvent)
  }
  return this
}

/* ----------------------------------------------------------------------------
 *  Mutex
 */

function Mutex( entered ){
  this.entered   = entered
  this.task      = null
  this.taskQueue = []
  this.closed    = false
}
ProtoMutex = Mutex.prototype

ProtoTask.mutex = function task_mutex( entered ){
  return new Mutex( entered)
}

ProtoMutex.__defineGetter__( "promise", function(){
  var promise = new Promise()
  var task = CurrentStep.task
  // when no need to queue...
  if( !this.entered || this.task === task ){
    // ... because same task cannot block itself
    if( this.entered ){
      promise.reject( new Error( "mutex already entered"))
    // ... because nobody's there
    }else{
      this.entered = true
      this.task    = task
      promise.resolve( this)
    }
  // when a new task wants to enter asap
  }else{
    this.queue.push( promise)
  }
  return promise
})

ProtoMutex.then = function( callback, errback ){
// Duck typing so that Task.wait() works
  return this.promise.then( callback, errback)
}

ProtoMutex.release = function(){
  if( !entered )return
  this.task = null
  var promise = this.promiseQueue.shift()
  if( promise ){
    promise.resolve( this)
  }else{
    this.entered = false
    this.task    = null
  }
}

ProtoMutex.close = function(){
  var list = this.promiseQueue
  this.promiseQueue = null
  var len = list.length
  for( var ii = 0 ; ii < len ; ii++ ){
    list[ii].reject( L8.CloseEvent)
  }
  return this
}

/* ----------------------------------------------------------------------------
 *  Lock
 */

function Lock( count ){
// aka "reentrant mutex"
  this.mutex  = new Mutex( count > 0 )
  this.count  = count || 0
  this.closed = false
}
ProtoLock = Lock.prototype

ProtoTask.lock = function task_lock( count ){
  return new Lock( count)
}

ProtoLock.__defineGetter__( "promise", function(){
  var that    = this
  var promise = new Promise()
  if( this.mutex.task === CurrentStep.task ){
    this.count++
    promise.resolve( that)
  }else{
    this.mutex.then( function(){
      this.count = 1
      promise.resolve( that)
    })
  }
  return promise
})

ProtoLock.then = function lock_then( callback, errback ){
  return this.promise.then( callback, errback)
}

ProtoLock.release = function(){
  if( this.count ){
    if( --this.count )return
  }
  this.mutex.release()
}

ProtoLock.__defineGetter__( "task", function(){
  return this.mutex.task
})

ProtoLock.close = function(){
  if( this.closed )return
  this.closed = true
  this.mutex.close()
  return this
}

/* ----------------------------------------------------------------------------
 *  Port. Producer/Consumer protocol with no buffering at all.
 */

function Port(){
  this.getPromise = null // "in"  promise, ready when ready to .get()
  this.putPromise = null // "out" promise, ready when ready to .put()
  this.value      = null
  this.closed     = false
}
ProtoPort = Port.prototype

ProtoTask.port = function task_port(){
  return new Port()
}

ProtoPort.__defineGetter__( "promise", function(){
  return this.in
})

ProtoPort.then = function port_then( callback, errback ){
  return this.in.then( callback, errback)
}

ProtoPort.get = function port_get(){
  this.out.resolve()
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.in.then( function( r ){
    if( !that.getPromise )return that.in
    that.getPromise = null
    that.value = r
    if( task.pausedStep === step ){
      task.resume()
      task.stepResult = r
    }
  })
  return this
}

ProtoPort.tryGet = function(){
// Like .get() but non blocking
  if( this.closed
  || !this.getPromise
  || this.getPromise.wasResolved
  )return [false]
  this.getPromise = null
  return [true, this.value]
}

ProtoPort.put = function port_put( msg ){
  var that = this
  this.in.resolve( msg)
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.out.then( function(){
    if( !that.putPromise )return that.out
    that.putPromise = null
    if( task.pausedStep === step ){
      task.resume()
    }
  })
  return this
}

ProtoPort.tryPut = function( msg ){
// Like .put() but non blocking
  if( this.closed
  ||  !this.putPromise
  ||  !this.putPromise.wasResolved
  )return false
  this.putPromise = null
  this.value = msg
  return true
}

ProtoPort.__defineGetter__( "in", function(){
  return this.getPromise
  ? this.getPromise = new Promise()
  : this.getPromise
})

ProtoPort.__defineGetter__( "out", function(){
  return this.putPromise
  ? this.putPromise = new Promise()
  : this.putPromise
})

/* ----------------------------------------------------------------------------
 *  MessageQueue. Producer/Consumer protocol with buffering.
 */

function MessageQueue( capacity ){
  this.capacity   = capacity || 1
  this.queue      = new Array( this.capacity)
  this.length     = 0
  this.getPromise = null // "in"  promise, ready when ready to .get()
  this.putPromise = null // "out" promise, ready when ready to .put()
  this.closed     = false
}
ProtoMessageQueue = MessageQueue.prototype

ProtoTask.queue = function task_queue( capacity ){
  return new MessageQueue( capacity)
}

ProtoMessageQueue.__defineGetter__( "promise", function(){
  return this.in
})

ProtoMessageQueue.then = function message_queue_then( callback, errback ){
  return this.in.then( callback, errback)
}

ProtoMessageQueue.put = function message_queue_put( msg ){
  var that = this
  var task = CurrentStep.task
  if( this.full ){
    task.pause()
    this.out.then( function(){
      task.queue.push( msg)
      task.resume()
      that.in.resolve()
      ++that.length
      if( !that.full ){
        that.out.resolve()
      }
    })
  }else{
    this.queue.push( msg)
    this.length++
    this.out.resolve()
  }
}

ProtoMessageQueue.tryPut = function message_queue_try_put( msg ){
  if( this.closed
  ||  this.full
  )return false
  this.queue.push( msg)
  this.length++
  this.out.resolve()
  return true
}

ProtoMessageQueue.get = function message_queue_get(){
  var that = this
  var step = CurrentStep
  var task = step.task
  if( this.empty ){
    task.pause()
    this.in.then( function(){
      if( task.step !== step )return
      task.stepResult = this.queue.shift()
      task.resume()
    })
  }else{
    task.stepResult = this.queue.shift()
    --this.length
    if( !that.empty ){
      that.in.resolve()
    }
  }
}

ProtoMessageQueue.tryGet = function message_queue_try_get(){
  if( this.closed
  ||  this.empty
  )return [false]
  var msg = this.queue.shift()
  --this.length
  if( !this.empty ){
    this.in.resolve()
  }
  return [true, msg]
}

ProtoMessageQueue.__defineGetter__( "in", function(){
  return this.getPromise
  ? this.getPromise = new Promise( !this.empty)
  : this.getPromise
})

ProtoMessageQueue.__defineGetter__( "out", function(){
  return this.putPromise
  ? this.putPromise = new Promise( !this.full)
  : this.putPromise
})

ProtoMessageQueue.__defineGetter__( "empty", function(){
  return !!this.length
})

ProtoMessageQueue.__defineGetter__( "full", function(){
  return this.length >= this.capacity
})

/* ----------------------------------------------------------------------------
 *  Generator. yield/again protocol
 */

function Generator( parent_task, block ){
  this.generatorTask = parent_task.spawn( block, true) // start_paused
  this.initDone   = false
  this.getPromise = null // "in"  promise, ready when ready to .next()
  this.inMessage  = null
  this.putPromise = null // "out" promise, ready when ready to .yield()
  this.outMessage = null
  this.closed     = false
}

ProtoGenerator = Generator.prototype

ProtoTask.generator = function task_generator( block ){
  return new Generator( this.current, block)
}

ProtoGenerator.__defineGetter__( "promise", function(){
  return this.in
})

ProtoGenerator.then = function port_then( callback, errback ){
  return this.in.then( callback, errback)
}

ProtoGenerator.next = function generator_next( msg ){
  var that = this
  this.out.resolve( this.outMessage = msg )
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.in.then( function(){
    this.getPromise = null
    if( task.pausedStep === step ){
      task.resume()
      if( that.closed )return task.break()
      task.stepResult = that.inMessage
    }
  })
  return this
}

ProtoGenerator.tryNext = function generator_try_next( msg ){
// Like .next() but never blocks
  if( this.closed )return [false]
  this.outMessage = msg
  this.out.resolve()
  if( !this.getPromise.wasResolved )return [false]
  this.getPromise = null
  return [true, that.inMessage]
}

ProtoGenerator.yield = function generator_yield( msg ){
  var that = this
  this.in.resolve( this.inMessage = msg)
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.out.then( function(){
    this.putPromise = null
    if( task.pausedStep === step ){
      task.resume()
      if( that.closed )return task.break()
      task.stepResult = that.outMessage
    }
  })
  return this
}

ProtoGenerator.tryYield = function generator_try_yield( msg ){
// Like .yield() but never blocks
  if( this.closed )return [false]
  this.inMessage = msg
  this.in.resolve()
  if( !this.putPromise.wasResolved )return [false]
  this.putPromise = null
  return [true, that.outMessage]
}

ProtoGenerator.close = function generator_close(){
  this.closed = true
  if( this.getPromise ){ this.getPromise.resolve() }
  if( this.putPromise ){ this.putPromise.resolve() }
  return this
}

ProtoPort.__defineGetter__( "in", function(){
  return this.getPromise
  ? this.getPromise = new Promise()
  : this.getPromise
})

ProtoPort.__defineGetter__( "out", function(){
  return this.putPromise
  ? this.putPromise = new Promise()
  : this.putPromise
})


/* ----------------------------------------------------------------------------
 *  Signal
 */

function Signal(){
  this.nextPromise = new Promise()
  this.closed = false
}
ProtoSignal = Signal.prototype

ProtoTask.signal = function task_signal( on ){
  return new Signal( on)
}

ProtoSignal.__defineGetter__( "promise", function(){
// Returns an unresolved promise that .signal() will resolve and .close() will
// reject.  Returns an already rejected promise if signal was closed.
  var promise = this.nextPromise
  if( this.closed )return promise
  return !promise.wasResolved ? promise : (this.nextPromise = new Promise())
})

ProtoMessageQueue.then = function signal_then( callback, errback ){
  return this.promise.then( callback, errback)
}

ProtoSignal.signal = function signal_signal( value ){
// Resolve an unresolved promise that .promise will provide. Signals are not
// buffered, only the last one is kept.
  if( this.nextPromise.wasResolved && !this.closed ){
    this.nextPromise = new Promise()
  }
  this.nextPromise.resolve( value )
}

ProtoSignal.close = function signal_close(){
  if( this.closed )return
  this.closed = yes
  if( this.nextPromise.wasResolved ){
    this.nextPromise = new Promise()
  }
  this.nextPromise.reject( L8.CloseEvent)
}

/* ----------------------------------------------------------------------------
 *  Timeout
 */

function Timeout( delay ){
  var promise = this.timedPromise = new Promise()
  setTimeout( function(){ promise.resolve() }, delay)
}
ProtoTimeout = Timeout.prototype

ProtoTask.timeout = function( delay ){
  return new Signal( on)
}

ProtoTimeout.__defineGetter__( "promise", function(){
  return this.timedPromise
})

ProtoTimeout.then = function( callback, errback ){
  return this.timedPromise.then( callback, errback)
}


/* ----------------------------------------------------------------------------
 *  Selector
 */

function Selector( list ){
  this.allPromises = list
  this.firePromise = null
  this.result      = null
}
ProtoSelector = Selector.prototype

ProtoTask.selector = ProtoTask.any = function(){
  var list = arguments.length = 1 ? arguments[0] : arguments
  return new Selector( list)
}

ProtoTask.select = function( arguments ){
  var selector = this.apply( this, arguments)
  return this.wait( selector)
}

ProtoSelector.__defineGetter__( "promise", function(){
  var promise = this.firePromise
  if( promise )return promise
  var that = this
  var list = this.allPromises
  this.firePromise = promise = new Promise( list.length === 0)
  var len = list.length
  var item
  for( var ii = 0 ; ii < len ; ii++ ){
    item = list[ii]
    item.then(
      function( r ){
        if( !that.result ){
          that.result = [null,r]
          promise.resolve( that)
        }
      },
      function( e ){
        if( !that.result ){
          that.result = [e,null]
          promise.reject(  that)
        }
      }
    )
  }
  return promise
})

ProtoSelector.then = function( callback, errback ){
  return promise.then( callback, errback)
}

/* ----------------------------------------------------------------------------
 *  Aggregator
 */

function Aggregator( list ){
  this.allPromises = list
  this.results     = []
  this.firePromise = null
}
ProtoAggregator = Aggregator.prototype

ProtoTask.aggregator = ProtoTask.all = function(){
  var list = arguments.length = 1 ? arguments[0] : arguments
  return new Aggregator( list)
}

ProtoAggregator.__defineGetter__( "promise", function(){
  var promise = this.firePromise
  if( promise )return promise
  var that = this
  var list = this.allPromises
  this.firePromise = promise = new Promise( list.length === 0)
  var results = this.results
  var len = list.length
  var item
  for( var ii = 0 ; ii < len ; ii++ ){
    item = list[ii]
    item.then(
      function( r ){
        results.push( [null,r])
        if( results.length === list.length ){
          promise.resolve( item)
        }
      },
      function( e ){
        results.push( [e,null])
        if( results.length === list.length ){
          promise.reject(  item)
        }
      }
    )
  }
  return promise
})

ProtoAggregator.then = function( callback, errback ){
  return promise.then( callback, errback)
}


/* ----------------------------------------------------------------------------
 *  Tests
 */

  var test

  var traces = []
  function t(){
    if( traces.length > 200 ){
      trace( "!!! Too many traces, infinite loop? exiting...")
      process.exit( 1)
    }
    var buf = ["test" + (test ? " " + test : ""), "" + CurrentStep]
    for( var ii = 0 ; ii < arguments.length ; ii++ ) buf.push( arguments[ii])
    buf = trace.apply( this, buf)
    traces.push( buf)
    return buf
  }

  function check(){
    var ii = 0
    var msg
    var tt = 0
    var tmsg
    while( ii < arguments.length ){
      msg = arguments[ii++]
      while( true ){
        tmsg = traces[tt]
        if( tmsg && tmsg.indexOf( msg) >= 0 )break
        if( ++tt >= traces.length ){
          var msg = "FAILED test " + test + ", missing trace: " + msg
          trace( msg)
          for( var jj = 0 ; jj < ii ; jj++ ){
            trace( arguments[jj])
          }
          traces = []
          throw new Error( msg)
        }
      }
    }
    trace( "Test " + test, "PASSED")
    traces = []
  }

  var test_1 = function test1(){
    test = 1
    t( "go")
    l8.begin
      .step(  function(){ t( "start")      })
      .step(  function(){ t( "step")       })
      .step(  function(){ t( "sleep")
                          this.sleep( 100)
                          t( "sleeping")   })
      .step(  function(){ t( "sleep done") })
      .final( function(){ t( "final")
        check( "start",
               "step",
               "sleep",
               "sleeping",
               "sleep done",
               "final"
        )
        test_2()
      })
    .end
  }

  var test_2 = L8.Task( function test2(){
    test = 2; this
    .step(  function(){ t( "start")               })
    .step(  function(){ setTimeout( this.walk, 0) })
    .step(  function(){ t( "sleep/timeout done")  })
    .final( function(){ t( "final")
      check( "start",
             "sleep/timeout done",
             "final"
      )
      test_3()
    })
  })

  var test_3 = L8.Task( function test3(){
    test = 3; this
    .step(    function(){ t( "start")             })
    .step(    function(){ t( "add step 1"); this
      .step(  function(){   t( "first step")  })
                          t( "add step 2"); this
      .step(  function(){   t( "second step") })  })
    .step(    function(){ t("third & final step") })
    .success( function(){ t("success")            })
    .final(   function(){ t( "final")
      check( "start",
             "success",
             "final"
      )
      test_4()
    })
  })

  var test_4 = L8.Task( function test4(){
    test = 4; this
    .step(    function(){ t( "start")                    })
    .step(    function(){ t( "raise error")
                          throw new Error( "step error") })
    .step(    function(){ t("!!! skipped step")          })
    .failure( function(){ t("error raised", this.error)  })
    .final(   function(){ t( "final")
      check( "start",
             "error raised",
             "final"
      )
      test_5()
    })
  })

  var test_5 = L8.Task( function test5(){
    test = 5; this.label = t( "start"); this
    .fork(    function(){ this.label = t( "fork 1"); this
      .step(  function(){ this.sleep( 10)       })
      .step(  function(){ t( "end fork 1")      })        })
    .fork(    function(){ this.label = t( "fork 2"); this
      .step(  function(){ this.sleep( 5)        })
      .step(  function(){ t( "end fork 2")      })        })
    .step(    function(){ t( "joined")          })
    .fork(    function(){ this.label = t( "fork 3"); this
      .step(  function(){ this.sleep( 1)        })
      .final( function(){ t( "final of fork 3") })        })
    .fork(    function(){ this.label = t( "fork 4"); this
      .final( function(){ t( "final of fork 4") })        })
    .step(    function(){ t( "joined again") })
    .final(   function(){ t( "final")
      check( "start",
             "fork 1",
             "fork 2",
             "end fork 2",
             "end fork 1",
             "joined",
             "fork 3",
             "fork 4",
             "final of fork 4",
             "final of fork 3",
             "joined again",
             "final"
      )
      test_6()
    })
  })

  var test_6 = L8.Task( function test6(){
    function other1(){ l8.step( function(){ t( "in other1")} )}
    function other2(){ l8.fork( function(){ t( "in other2")} )}
    test = 6; this
    .step(  function(){ other1(); t( "other1() called")        })
    .step(  function(){ t( "other1 result", this.result); this
                        other2(); t( "other2() called")        })
    .step(  function(){ t( "other2 result", this.result)       })
    .final( function(){ t( "final result", this.result)
      check( "other1() called",
             "in other1",
             "other1 result",
             "other2() called",
             "in other2",
             "other2 result",
             "final result"
      )
      test_7()
    })
  })

  var test_7 = L8.Task( function test7(){
    test = 7
    var ii; this
    .step(   function(){ t( "simple, times", ii = 3)     })
    .repeat( function(){ t( "repeat simple step", ii)
                         if( --ii === 0 ){
                           t( "break simple repeat")
                           this.break
                         }                               })
    .step(   function(){ t( "simple repeat done")        })
    .step(   function(){ t( "sleep, times", ii = 2)      })
    .repeat( function(){ this
      .step( function(){   t( "repeat sleep", ii)
                           this.sleep( 1)                })
      .step( function(){   t( "done sleep", ii)          })
      .step( function(){   if( --ii === 0 ){
                             t( "break sleep repeat")
                             this.break
                           }                          }) })
    .step(   function(){ t( "done ")                     })
    .failure( function( e ){ t( "unexpected failure", e)
                             throw e                      })
    .final(  function(){ t( "final result", this.result)
      check( "simple, times",
             "repeat simple",
             "break simple repeat",
             "simple repeat done",
             "sleep, times",
             "done sleep",
             "break sleep repeat",
             "done",
             "final result"
      )
      test_8()
    })
  })

  var test_8 = L8.compile( function r(){
    test = 8
    var f1 = L8.Task( function( p1, p2 ){
      t( "p1", p1, "p2", p2)
      return [p1,p2]
    })
    step;
      t( "pass parameter, get result");
      f1( "aa", "bb")
    step( r );
      t( "both", r.join( "+"))
      f1( "11", "22")
    step( a, b ); t( "a", a, "b", b)
    final; check(
      "p1, aa, p2, bb",
      "both, aa+bb",
      "a, 11, b, 22"
    )
    test_last()
  })

  var test_last = function(){
    trace( "SUCCESS!!! all tests ok")
  }

trace( "starting L8")
var count_down = 10
setInterval(
  function(){
    trace( "tick " + --count_down)
    if( !count_down ){
      trace( "exiting...")
      process.exit( 0)
    }
  },
  1000
)
test_1()

